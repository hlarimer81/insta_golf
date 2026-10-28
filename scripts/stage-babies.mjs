#!/usr/bin/env node
/**
 * Stage golf-babies Reels into their own afternoon lane of the cloud queue:
 * write sketches, render them on fal.ai, and enqueue one per day.
 *
 *   npm run stage:babies                     # 7 Reels
 *   npm run stage:babies -- --count 14
 *   npm run stage:babies -- --count 3 --topic "the first tee"
 *
 * Options:
 *   --count N        Reels to stage (default 7)
 *   --topic "..."    sketch topic (default: babies.mjs's weekend-golf misery)
 *   --utc-hour H     hour (UTC) each one is due (default 20). The poster fires
 *                    at 13:00 and 21:00 UTC, so 20:00 is picked up at 21:00:
 *                    5pm Eastern in summer, 4pm in winter. The morning post is
 *                    due at 12:00 and goes at 13:00, so the two never compete.
 *   --concurrency N  renders in flight at once (default 3)
 *
 * Styles alternate day by day — talk, slapstick, talk — continuing from
 * whatever the last queued babies Reel was. Each style is written as its own
 * batch so the judge in babies.mjs ranks talk against talk and falls against
 * falls; mixed together, the falls lose.
 *
 * There is no review gate: sketches go straight to video, and the owner
 * reviews them on Instagram. Each render costs real money (~$0.30/second on
 * Seedance 720p), which is why a failed render is skipped rather than retried.
 */
import { spawn, spawnSync } from "node:child_process";
import { readdirSync, existsSync, renameSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { makeS3, getJson } from "./lib/s3.mjs";
import { inBabiesLane } from "./lib/babies.mjs";

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
for (const k of ["AWS_REGION", "S3_BUCKET", "ANTHROPIC_API_KEY", "FAL_KEY"]) {
  if (!process.env[k]) {
    console.error(`Missing ${k}. See .env.example.`);
    process.exit(1);
  }
}

// ---- args -----------------------------------------------------------------
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const count = parseInt(opt("count", "7"), 10);
const topic = opt("topic", null);
const utcHour = parseInt(opt("utc-hour", "20"), 10);
const concurrency = parseInt(opt("concurrency", "3"), 10);
if (!(count >= 1)) {
  console.error("--count must be a positive integer.");
  process.exit(1);
}

function run(args) {
  const res = spawnSync("node", args, { cwd: root, stdio: "inherit" });
  if (res.status !== 0) {
    console.error(`✗ step failed: node ${args.join(" ")}`);
    process.exit(res.status ?? 1);
  }
}

// ---- 1. pick the styles, continuing the alternation -----------------------
const s3 = makeS3(process.env.AWS_REGION);
const queue = (await getJson(s3, {
  bucket: process.env.S3_BUCKET,
  key: process.env.CLOUD_QUEUE_KEY ?? "queue.json",
})) ?? { entries: [] };
const lane = queue.entries
  .filter((e) => inBabiesLane(e) && e.status !== "failed")
  .sort((a, b) => a.publishAt.localeCompare(b.publishAt));
const last = lane.at(-1);

// Slapstick first on a fresh lane: the falls are the part the owner liked.
const STYLES = ["slapstick", "talk"];
const firstStyle = last?.style === "slapstick" ? "talk" : "slapstick";
const order = Array.from({ length: count }, (_, i) => STYLES[(STYLES.indexOf(firstStyle) + i) % 2]);
const want = { talk: order.filter((s) => s === "talk").length, slapstick: order.filter((s) => s === "slapstick").length };

// ---- 2. write each style's sketches and approve them ----------------------
function generate(n, style) {
  if (n === 0) return [];
  const before = existsSync(draftsDir) ? new Set(readdirSync(draftsDir)) : new Set();
  console.log(`\n① Writing ${n} ${style} sketch(es)…\n`);
  run(["scripts/babies.mjs", "--style", style, "--count", String(n), ...(topic ? [topic] : [])]);
  const created = readdirSync(draftsDir).filter((f) => f.endsWith(".json") && !before.has(f)).sort();
  // No review gate: the owner reviews on Instagram, so promote straight to scripts/.
  return created.map((f) => {
    renameSync(join(draftsDir, f), join(scriptsDir, f));
    return f.replace(/\.json$/, "");
  });
}
const written = { talk: generate(want.talk, "talk"), slapstick: generate(want.slapstick, "slapstick") };

// ---- 3. render, a few at a time -------------------------------------------
function render(slug) {
  return new Promise((done) => {
    const child = spawn("node", ["scripts/render-babies.mjs", slug], { cwd: root, stdio: "inherit" });
    child.on("close", (code) => done(code === 0 && existsSync(join(root, "out", `${slug}.mp4`))));
  });
}
const all = [...written.talk, ...written.slapstick];
console.log(`\n② Rendering ${all.length} video(s), ${concurrency} at a time…\n`);
const ok = new Set();
const pending = [...all];
await Promise.all(
  Array.from({ length: concurrency }, async () => {
    for (let slug; (slug = pending.shift()); ) if (await render(slug)) ok.add(slug);
  }),
);
const failed = all.filter((s) => !ok.has(s));
if (failed.length) console.log(`\n⚠️  ${failed.length} render(s) failed, skipped: ${failed.join(", ")}`);

// ---- 4. schedule in alternating order, one per afternoon -------------------
// Built from what actually rendered, so a failed render shortens the run
// instead of leaving a hole. If one style ran short the other fills in.
const left = { talk: written.talk.filter((s) => ok.has(s)), slapstick: written.slapstick.filter((s) => ok.has(s)) };
const plan = [];
for (const style of order) {
  const slug = left[style].shift() ?? left[style === "talk" ? "slapstick" : "talk"].shift();
  if (slug) plan.push(slug);
}
if (plan.length === 0) {
  console.error("✗ nothing rendered, nothing staged.");
  process.exit(1);
}

let start = last ? new Date(new Date(last.publishAt).getTime() + 86400000) : new Date(Date.now() + 86400000);
const tomorrow = new Date(Date.now() + 86400000);
// A lane that ran dry would otherwise schedule into the past, and every post
// would be due at the next firing.
if (start < tomorrow) start = tomorrow;
start.setUTCHours(utcHour, 0, 0, 0);

console.log("\n③ Enqueuing…\n");
plan.forEach((slug, i) => {
  const when = new Date(start);
  when.setUTCDate(start.getUTCDate() + i);
  const { style } = JSON.parse(readFileSync(join(scriptsDir, `${slug}.json`), "utf8"));
  console.log(`   👶 ${when.toISOString().slice(0, 10)}  ${style.padEnd(9)} ${slug}`);
  run(["scripts/enqueue.mjs", slug, "--at", when.toISOString()]);
});

console.log(`\n✅ Staged ${plan.length} babies Reel(s).`);
// A partial run still counts as progress, but the job should go red so the
// failed renders get looked at.
if (failed.length) process.exit(1);
