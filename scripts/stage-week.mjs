#!/usr/bin/env node
/**
 * Stage a full week (or two) of content in one command: generate scripts,
 * render them, and enqueue them to the cloud queue. Everything ships as a Reel
 * unless --allow-static is passed.
 *
 *   npm run stage:week
 *   npm run stage:week -- --count 14 --backgrounds
 *   npm run stage:week -- --count 7 --humor 0 --topic "putting and short game"
 *   npm run stage:week -- --start 2026-09-01 --allow-static
 *
 * Options:
 *   --count N         posts to stage (default 7)
 *   --humor N         how many of those are jokes (default: half). Jokes are
 *                     spread evenly through the run. --humor 0 = tips only.
 *   --topic "..."     tip generation topic (default: broad weekend-golfer tips)
 *   --humor-topic "..."  joke generation topic (default: weekend-golf misery)
 *   --start YYYY-MM-DD first post date (default: the day after the last
 *                     already-queued post, so weeks append cleanly)
 *   --utc-hour H      hour (UTC) to post each day (default 12; the daily
 *                     Lambda cron fires at 13:00 UTC)
 *   --allow-static    stage some posts as static feed content (tips alternate
 *                     reel/carousel, jokes alternate Reel/image meme). OFF by
 *                     default: static posts average 5 views on this account
 *                     against 74 for Reels, so everything ships as a Reel.
 *   --start-format reel|carousel   which format the first TIP is (default
 *                     reel); only meaningful with --allow-static
 *   --backgrounds     also generate an AI background per post (needs FAL_KEY;
 *                     costs ~1–4¢/image). Diagrams are automatic either way.
 *
 * Reuses the existing generate / render / render:carousel / render:meme /
 * enqueue tools, so behavior stays identical to running them by hand.
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
const humorTopic = opt("humor-topic", "the everyday indignities of weekend golf: the shanks, the provisional, slow play, gear that doesn't help");
const startArg = opt("start", null);
const utcHour = parseInt(opt("utc-hour", "12"), 10);
const startFormat = opt("start-format", "reel") === "carousel" ? "carousel" : "reel";
const allowStatic = argv.includes("--allow-static");
const backgrounds = argv.includes("--backgrounds");
const humorCount = Math.max(
  0,
  Math.min(count, parseInt(opt("humor", String(Math.floor(count / 2))), 10)),
);
const tipCount = count - humorCount;

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

// Generate `n` scripts of a kind and promote the new drafts into scripts/
// (no-review model). Returns the slugs in the order they were written.
function generate(n, kind, subject) {
  if (n === 0) return [];
  const before = existsSync(draftsDir) ? new Set(readdirSync(draftsDir)) : new Set();
  run(["scripts/generate.mjs", "--count", String(n), "--kind", kind, subject]);

  const created = (existsSync(draftsDir) ? readdirSync(draftsDir) : [])
    .filter((f) => f.endsWith(".json") && !before.has(f))
    .sort();
  if (created.length === 0) {
    console.error(`No ${kind} scripts were generated.`);
    process.exit(1);
  }
  return created.map((f) => {
    renameSync(join(draftsDir, f), join(scriptsDir, f));
    return f.replace(/\.json$/, "");
  });
}

// ---- 1. generate scripts --------------------------------------------------
console.log(`\n① Generating ${tipCount} tip script(s) + ${humorCount} joke(s)\n`);
const tipSlugs = generate(tipCount, "tip", topic);
const jokeSlugs = generate(humorCount, "joke", humorTopic);
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
  // If the queue has been drained for a while, that day is in the past and
  // every post would be due on the next firing. Start tomorrow instead.
  const tomorrow = new Date(Date.now() + 86400000);
  if (start < tomorrow) start = tomorrow;
}
start.setUTCHours(utcHour, 0, 0, 0);

// Everything is a Reel by default. Under --allow-static the old alternation
// comes back: tips flip reel ↔ carousel, jokes flip Reel ↔ meme. Humor is
// spread evenly across the run rather than clumped, and day 1 is a tip
// whenever there are any.
const plan = [];
let placedHumor = 0;
let tipIdx = 0;
let jokeIdx = 0;
for (let i = 0; i < count; i++) {
  const isHumor = Math.floor(((i + 1) * humorCount) / count) > placedHumor;
  const when = new Date(start);
  when.setUTCDate(start.getUTCDate() + i);
  if (isHumor) {
    placedHumor++;
    plan.push({
      slug: jokeSlugs[jokeIdx],
      role: allowStatic && jokeIdx % 2 === 1 ? "meme" : "joke",
      iso: when.toISOString(),
    });
    jokeIdx++;
  } else {
    const flip = allowStatic
      ? tipIdx % 2 === 0
        ? startFormat
        : startFormat === "reel"
          ? "carousel"
          : "reel"
      : "reel";
    plan.push({ slug: tipSlugs[tipIdx], role: flip, iso: when.toISOString() });
    tipIdx++;
  }
}

const ICON = { reel: "🎬", carousel: "🎠", joke: "😄🎬", meme: "😄🖼 " };
console.log("\n② Plan:");
for (const p of plan) {
  console.log(`   ${ICON[p.role]} ${p.iso.slice(0, 10)}  ${p.slug}`);
}

// ---- 3. render + enqueue each ---------------------------------------------
console.log("\n③ Rendering & enqueuing…");
for (const p of plan) {
  // Reels are 9:16; carousels and memes are 4:5.
  if (backgrounds) {
    const ratio = p.role === "reel" || p.role === "joke" ? "9:16" : "4:5";
    console.log(`   🎨 background for ${p.slug}…`);
    run(["scripts/bg.mjs", p.slug, "--ratio", ratio], { quiet: true });
  }
  if (p.role === "carousel") {
    console.log(`   🎠 rendering ${p.slug}…`);
    run(["scripts/render-carousel.mjs", p.slug], { quiet: true });
    run(["scripts/enqueue.mjs", p.slug, "--at", p.iso, "--carousel"]);
  } else if (p.role === "meme") {
    console.log(`   🖼  rendering ${p.slug}…`);
    run(["scripts/render-meme.mjs", p.slug], { quiet: true });
    run(["scripts/enqueue.mjs", p.slug, "--at", p.iso, "--meme"]);
  } else {
    console.log(`   🎬 rendering ${p.slug}…`);
    run(["scripts/render.mjs", `scripts/${p.slug}.json`], { quiet: true });
    run(["scripts/enqueue.mjs", p.slug, "--at", p.iso]);
  }
}

const tally = plan.reduce((m, p) => ((m[p.role] = (m[p.role] || 0) + 1), m), {});
console.log(
  `\n✅ Staged ${plan.length} posts (` +
    `${tally.reel ?? 0} tip reels, ${tally.carousel ?? 0} carousels, ` +
    `${tally.joke ?? 0} joke reels, ${tally.meme ?? 0} memes).`,
);
console.log('   Check with "npm run enqueue -- list".');
