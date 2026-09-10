#!/usr/bin/env node
/**
 * Keep the cloud queue from ever running dry.
 *
 *   npm run ensure:queue                    # top up if fewer than 7 posts remain
 *   npm run ensure:queue -- --min 7 --target 14
 *   npm run ensure:queue -- --dry-run       # report only, stage nothing
 *
 * Counts the posts still scheduled for the future and, when that falls below
 * --min, stages exactly enough to reach --target. It is a no-op on most runs,
 * which is the point: run it daily and the queue heals itself instead of
 * silently draining. (It drained on 2026-08-31 and the account sat dark for
 * nine days before anyone noticed.)
 *
 * Exit codes: 0 = fine or topped up, 1 = something failed. The GitHub Action in
 * .github/workflows/keep-queue-full.yml runs this every morning.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { makeS3, getJson } from "./lib/s3.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (existsSync(join(root, ".env"))) {
  try {
    process.loadEnvFile(join(root, ".env"));
  } catch {
    /* ignore */
  }
}
for (const k of ["AWS_REGION", "S3_BUCKET"]) {
  if (!process.env[k]) {
    console.error(`Missing ${k}. See .env.example.`);
    process.exit(1);
  }
}

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const min = parseInt(opt("min", "7"), 10);
const target = parseInt(opt("target", "14"), 10);
const dryRun = argv.includes("--dry-run");
const topic = opt("topic", null);

if (min > target) {
  console.error(`--min (${min}) can't exceed --target (${target}).`);
  process.exit(1);
}

const s3 = makeS3(process.env.AWS_REGION);
const queue = (await getJson(s3, {
  bucket: process.env.S3_BUCKET,
  key: process.env.CLOUD_QUEUE_KEY ?? "queue.json",
})) ?? { entries: [] };

const now = Date.now();
const upcoming = queue.entries
  .filter((e) => e.status === "pending" && new Date(e.publishAt).getTime() > now)
  .sort((a, b) => a.publishAt.localeCompare(b.publishAt));

const lastDay = upcoming.length ? upcoming[upcoming.length - 1].publishAt.slice(0, 10) : "—";
console.log(`Queue: ${upcoming.length} post(s) scheduled ahead, through ${lastDay}.`);

// A post that failed to publish is invisible to the count above but is a real
// hole in the calendar, so surface it rather than silently backfilling past it.
const failed = queue.entries.filter((e) => e.status === "failed");
if (failed.length) {
  console.log(`⚠️  ${failed.length} failed entr(ies): ${failed.map((e) => e.slug).join(", ")}`);
}

if (upcoming.length >= min) {
  console.log(`At or above the floor of ${min}. Nothing to do.`);
  process.exit(0);
}

const shortfall = target - upcoming.length;
// Roughly one joke a week; the data says jokes and tips draw the same views, so
// this is for variety, not reach.
const humor = Math.max(1, Math.round(shortfall / 7));
console.log(`Below the floor of ${min} — staging ${shortfall} more (${humor} joke(s)).`);

if (dryRun) {
  console.log("--dry-run: stopping before staging.");
  process.exit(0);
}

const args = [
  "scripts/stage-week.mjs",
  "--count", String(shortfall),
  "--humor", String(humor),
  "--backgrounds",
];
if (topic) args.push("--topic", topic);

const res = spawnSync("node", args, { cwd: root, stdio: "inherit" });
if (res.status !== 0) {
  console.error("✗ staging failed.");
  process.exit(1);
}
console.log(`✅ Queue topped up to ${target}.`);
