#!/usr/bin/env node
/**
 * Record today's follower count, and print the history so far.
 *
 *   npm run followers                # record + print
 *   npm run followers -- --dry-run   # print only, write nothing
 *
 * Run daily by .github/workflows/keep-queue-full.yml. Instagram keeps no
 * follower history for small accounts, so a day this doesn't run is a day of
 * growth nobody can read back later.
 *
 * Env: AWS_REGION, S3_BUCKET, IG_ACCESS_TOKEN (IG_USER_ID optional).
 */
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { makeS3 } from "./lib/s3.mjs";
import { fetchAccount } from "./lib/ig-stats.mjs";
import { loadFollowerHistory, recordFollowers } from "./lib/followers.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (existsSync(join(root, ".env"))) {
  try {
    process.loadEnvFile(join(root, ".env"));
  } catch {
    /* ignore */
  }
}
for (const k of ["AWS_REGION", "S3_BUCKET", "IG_ACCESS_TOKEN"]) {
  if (!process.env[k]) {
    console.error(`Missing ${k}.`);
    process.exit(1);
  }
}

const dryRun = process.argv.includes("--dry-run");
const version = process.env.GRAPH_API_VERSION ?? "v21.0";
const s3 = makeS3(process.env.AWS_REGION);
const bucket = process.env.S3_BUCKET;

const account = await fetchAccount({ token: process.env.IG_ACCESS_TOKEN, version });
if (!account.ok || typeof account.followers !== "number") {
  console.error(`❌ Couldn't read the follower count: ${account.error ?? "no followers_count returned"}`);
  process.exit(1);
}

const snapshots = dryRun
  ? await loadFollowerHistory(s3, bucket)
  : await recordFollowers(s3, bucket, { followers: account.followers });

console.log(`@${account.username}: ${account.followers} followers, ${account.mediaCount} posts.`);
console.log(dryRun ? "(--dry-run: not recorded)" : `Recorded. History now ${snapshots.length} day(s):`);
let prev = null;
for (const s of snapshots.slice(-14)) {
  const d = prev == null ? "" : `  ${s.followers - prev >= 0 ? "+" : ""}${s.followers - prev}`;
  console.log(`   ${s.date}  ${s.followers}${d}`);
  prev = s.followers;
}
