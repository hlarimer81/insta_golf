#!/usr/bin/env node
/**
 * Stage golf-babies Reels into the cloud queue: write sketches, render them
 * (Gemini Omni Flash by default, see render-babies.mjs), and enqueue each into
 * the earliest open posting slot.
 *
 *   npm run stage:babies                     # 7 Reels
 *   npm run stage:babies -- --count 14
 *   npm run stage:babies -- --count 3 --topic "the first tee"
 *
 * Options:
 *   --count N        Reels to stage (default 7)
 *   --topic "..."    sketch topic (default: babies.mjs's weekend-golf misery)
 *   --slots H,H      UTC hours a babies Reel may be due (default 12,20). The
 *                    poster fires at 13:00 and 21:00 UTC, so 12:00 goes at
 *                    13:00 (8am Eastern in winter) and 20:00 at 21:00 (4pm).
 *   --concurrency N  renders in flight at once (default 3)
 *
 * Two a day, once the tips run out. A slot counts as taken when anything, tip
 * or baby, is due for the poster firing that would publish it, so babies fill
 * the 20:00 slots alongside the remaining morning tips and only take the
 * mornings once those have posted. The poster publishes one post per firing,
 * so two posts due for the same firing would push every later post back a
 * slot; keying by firing rather than exact time rules that out.
 *
 * Two slapstick for every talk sketch (nextStyles in lib/babies.mjs: the falls
 * hold viewers, the talk loses them), continuing the pattern from the babies
 * Reels already queued. Each style is written as its own
 * batch so the judge in babies.mjs ranks talk against talk and falls against
 * falls; mixed together, the falls lose.
 *
 * There is no review gate: sketches go straight to video, and the owner
 * reviews them on Instagram. Each render costs real money (~$0.07/second on
 * Omni Flash 720p, ~$0.30 on Seedance), which is why a failed render is
 * skipped rather than retried.
 */
import { spawn, spawnSync } from "node:child_process";
import { readdirSync, existsSync, renameSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { makeS3, getJson } from "./lib/s3.mjs";
import { inBabiesLane, DEFAULT_VIDEO_MODEL, openSlots, nextStyles } from "./lib/babies.mjs";

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
// The same default render-babies.mjs uses, so the key checked here is the
// one the renders will need.
const videoModel = process.env.BABIES_VIDEO_MODEL || process.env.FAL_VIDEO_MODEL || DEFAULT_VIDEO_MODEL;
const videoKey = videoModel.startsWith("gemini-omni") ? "GEMINI_API_KEY" : "FAL_KEY";
for (const k of ["AWS_REGION", "S3_BUCKET", "ANTHROPIC_API_KEY", videoKey]) {
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
const slotHours = opt("slots", "12,20")
  .split(",")
  .map((h) => parseInt(h, 10))
  .sort((a, b) => a - b);
if (!slotHours.length || slotHours.some((h) => !(h >= 0 && h <= 23))) {
  console.error("--slots must be comma-separated UTC hours, e.g. 12,20.");
  process.exit(1);
}
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

const order = nextStyles(lane.map((e) => e.style).filter(Boolean), count);
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

const slots = openSlots(queue.entries, plan.length, slotHours);

console.log("\n③ Enqueuing…\n");
plan.forEach((slug, i) => {
  const when = slots[i];
  const { style } = JSON.parse(readFileSync(join(scriptsDir, `${slug}.json`), "utf8"));
  console.log(`   👶 ${when.toISOString().slice(0, 16).replace("T", " ")}  ${style.padEnd(9)} ${slug}`);
  run(["scripts/enqueue.mjs", slug, "--at", when.toISOString()]);
});

console.log(`\n✅ Staged ${plan.length} babies Reel(s).`);
// A partial run still counts as progress, but the job should go red so the
// failed renders get looked at.
if (failed.length) process.exit(1);
