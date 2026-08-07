#!/usr/bin/env node
/**
 * Stage a full week of content in one command: generate scripts, render them
 * (Reels + carousels, interleaved), and enqueue them to the cloud queue.
 *
 *   npm run stage:week
 *   npm run stage:week -- --count 7 --topic "putting and short game"
 *   npm run stage:week -- --start 2026-09-01 --start-format carousel
 *
 * Options:
 *   --count N         posts to stage (default 7)
 *   --topic "..."     generation topic (default: broad weekend-golfer tips)
 *   --start YYYY-MM-DD first post date (default: the day after the last
 *                     already-queued post, so weeks append cleanly)
 *   --utc-hour H      hour (UTC) to post each day (default 12; the daily
 *                     Lambda cron fires at 13:00 UTC)
 *   --start-format reel|carousel   which format day 1 is (default reel);
 *                     alternates from there
 *   --backgrounds     also generate an AI background per reel (needs FAL_KEY;
 *                     costs ~1–4¢/image). Diagrams are automatic either way.
 *
 * Reuses the existing generate / render / render:carousel / enqueue tools, so
 * behavior stays identical to running them by hand.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, existsSync, renameSync, rmdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { makeS3, getJson } from "./lib/s3.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scriptsDir = join(root, "scripts");
const draftsDir = join(scriptsDir, "drafts");

if (existsSync(join(root, ".env"))) {
  try {
    process.loadEnvFile(join(root, ".env"));
  } catch {
    /* ignore */
  }
}

// ---- args -----------------------------------------------------------------
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const count = parseInt(opt("count", "7"), 10);
const topic = opt("topic", "golf tips for weekend players: short game, putting, driving, iron play, course management");
const startArg = opt("start", null);
const utcHour = parseInt(opt("utc-hour", "12"), 10);
const startFormat = opt("start-format", "reel") === "carousel" ? "carousel" : "reel";
const backgrounds = argv.includes("--backgrounds");

// Run a child tool; inherit output unless quiet (then capture stderr for errors).
function run(args, { quiet = false } = {}) {
  const res = spawnSync("node", args, {
    cwd: root,
    stdio: quiet ? ["ignore", "ignore", "pipe"] : "inherit",
    encoding: "utf8",
  });
  if (res.status !== 0) {
    if (quiet && res.stderr) console.error(res.stderr.slice(-800));
    console.error(`✗ step failed: node ${args.join(" ")}`);
    process.exit(res.status ?? 1);
  }
}

// ---- 1. generate scripts (into drafts/) -----------------------------------
console.log(`\n① Generating ${count} scripts on: ${topic}\n`);
const before = existsSync(draftsDir) ? new Set(readdirSync(draftsDir)) : new Set();
run(["scripts/generate.mjs", "--count", String(count), topic]);

const created = (existsSync(draftsDir) ? readdirSync(draftsDir) : [])
  .filter((f) => f.endsWith(".json") && !before.has(f))
  .sort();
if (created.length === 0) {
  console.error("No scripts were generated.");
  process.exit(1);
}
// Promote drafts → scripts/ (no-review model).
const slugs = created.map((f) => {
  renameSync(join(draftsDir, f), join(scriptsDir, f));
  return f.replace(/\.json$/, "");
});
try {
  if (existsSync(draftsDir) && readdirSync(draftsDir).length === 0) rmdirSync(draftsDir);
} catch {
  /* leave non-empty drafts dir */
}

// ---- 2. compute the schedule (append after the last queued post) ----------
let start;
if (startArg) {
  start = new Date(`${startArg}T00:00:00Z`);
} else {
  const s3 = makeS3(process.env.AWS_REGION);
  const queue = (await getJson(s3, {
    bucket: process.env.S3_BUCKET,
    key: process.env.CLOUD_QUEUE_KEY ?? "queue.json",
  })) ?? { entries: [] };
  const maxIso = queue.entries.reduce((m, e) => (e.publishAt > m ? e.publishAt : m), "");
  const base = maxIso ? new Date(maxIso) : new Date();
  start = new Date(base.getTime() + 86400000); // day after the last post
}
start.setUTCHours(utcHour, 0, 0, 0);

const plan = slugs.map((slug, i) => {
  const role = i % 2 === 0 ? startFormat : startFormat === "reel" ? "carousel" : "reel";
  const when = new Date(start);
  when.setUTCDate(start.getUTCDate() + i);
  return { slug, role, iso: when.toISOString() };
});

console.log("\n② Plan:");
for (const p of plan) {
  console.log(`   ${p.role === "carousel" ? "🎠" : "🎬"} ${p.iso.slice(0, 10)}  ${p.slug}`);
}

// ---- 3. render + enqueue each ---------------------------------------------
console.log("\n③ Rendering & enqueuing…");
for (const p of plan) {
  if (p.role === "carousel") {
    console.log(`   🎠 rendering ${p.slug}…`);
    run(["scripts/render-carousel.mjs", p.slug], { quiet: true });
    run(["scripts/enqueue.mjs", p.slug, "--at", p.iso, "--carousel"]);
  } else {
    if (backgrounds) {
      console.log(`   🎨 background for ${p.slug}…`);
      run(["scripts/bg.mjs", p.slug], { quiet: true });
    }
    console.log(`   🎬 rendering ${p.slug}…`);
    run(["scripts/render.mjs", `scripts/${p.slug}.json`], { quiet: true });
    run(["scripts/enqueue.mjs", p.slug, "--at", p.iso]);
  }
}

console.log(
  `\n✅ Staged ${plan.length} posts (${plan.filter((p) => p.role === "reel").length} reels, ` +
    `${plan.filter((p) => p.role === "carousel").length} carousels).`,
);
console.log('   Check with "npm run enqueue -- list".');
