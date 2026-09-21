#!/usr/bin/env node
/**
 * Rebuild the captions on queued-but-unpublished entries.
 *
 *   npm run recaption -- --dry-run   # show what would change, write nothing
 *   npm run recaption                # back up the queue, then apply
 *
 * Captions are baked in at enqueue time (see scripts/enqueue.mjs), so a change
 * to buildCaption only reaches posts queued afterwards. Everything already
 * sitting in the queue keeps whatever caption it was given -- which is why
 * adding topic hashtags did nothing for the month already scheduled.
 *
 * Only `pending` entries are touched. A published post's caption lives on
 * Instagram, not here; rewriting it in the queue would change nothing and would
 * lose the record of what actually went out.
 *
 * Env: AWS_REGION, S3_BUCKET.
 */
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { makeS3, getJson, putJson } from "./lib/s3.mjs";
import { buildCaption } from "./lib/instagram.mjs";

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
    console.error(`Missing ${k} in .env. See .env.example.`);
    process.exit(1);
  }
}

const dryRun = process.argv.includes("--dry-run");
const bucket = process.env.S3_BUCKET;
const key = process.env.CLOUD_QUEUE_KEY ?? "queue.json";
const scriptsDir = join(root, "scripts");

const s3 = makeS3(process.env.AWS_REGION);
const queue = await getJson(s3, { bucket, key });
if (!queue?.entries?.length) {
  console.error(`No queue at s3://${bucket}/${key}.`);
  process.exit(1);
}

const tail = (c) => c.split("\n").filter(Boolean).pop() ?? "";

const changed = [];
const missing = [];
const same = [];

for (const entry of queue.entries) {
  if (entry.status !== "pending") continue;

  const scriptPath = join(scriptsDir, `${entry.slug}.json`);
  if (!existsSync(scriptPath)) {
    missing.push(entry.slug);
    continue;
  }
  const reel = JSON.parse(readFileSync(scriptPath, "utf8"));
  const next = buildCaption(reel);
  if (next === entry.caption) {
    same.push(entry.slug);
    continue;
  }
  changed.push({ entry, from: entry.caption, to: next });
}

console.log(
  `\n${queue.entries.length} entries — ` +
    `${changed.length} to update, ${same.length} already current, ` +
    `${missing.length} with no script.\n`,
);

for (const { entry, from, to } of changed) {
  console.log(`${entry.publishAt.slice(0, 10)}  ${entry.slug}`);
  console.log(`   - ${tail(from)}`);
  console.log(`   + ${tail(to)}`);
}
if (missing.length) {
  console.log(`\n⚠️  No script found for: ${missing.join(", ")}`);
  console.log("   Their captions are left exactly as they are.");
}

if (!changed.length) {
  console.log("\nNothing to do.");
  process.exit(0);
}

if (dryRun) {
  console.log("\n--dry-run: nothing written.");
  process.exit(0);
}

// Keep the pre-change queue retrievable. This is the live posting schedule;
// a bad write here is a month of wrong captions with no way back.
const backupKey = `${key.replace(/\.json$/, "")}.backup-${new Date()
  .toISOString()
  .replace(/[:.]/g, "-")}.json`;
await putJson(s3, { bucket, key: backupKey, data: queue });
console.log(`\n🗄  Backed up to s3://${bucket}/${backupKey}`);

for (const { entry, to } of changed) entry.caption = to;
await putJson(s3, { bucket, key, data: queue });
console.log(`✅  Updated ${changed.length} caption(s) in s3://${bucket}/${key}`);
