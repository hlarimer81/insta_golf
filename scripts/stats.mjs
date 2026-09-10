#!/usr/bin/env node
/**
 * Pull performance stats for posted Reels from the Instagram Graph API.
 *
 *   npm run stats
 *   npm run stats -- --days 30      # only posts from the last 30 days
 *
 * Reads the published entries (those with a media id) from the cloud queue in
 * S3, then fetches each Reel's numbers: likes/comments from the media object,
 * and reach/views/saves/shares from the insights endpoint.
 *
 * Requires IG_ACCESS_TOKEN in .env. NOTE: the insights (reach/views/saves/
 * shares) need the `instagram_manage_insights` permission — if your token was
 * made without it, the tool still shows likes/comments and prints how to fix it.
 */
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { makeS3, getJson } from "./lib/s3.mjs";
import { fetchStats, tokenHealth, sum } from "./lib/ig-stats.mjs";

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
    console.error(`Missing ${k} in .env. See .env.example.`);
    process.exit(1);
  }
}

const argv = process.argv.slice(2);
const daysArg = argv.indexOf("--days");
const days = daysArg >= 0 && argv[daysArg + 1] ? parseInt(argv[daysArg + 1], 10) : null;

const region = process.env.AWS_REGION;
const bucket = process.env.S3_BUCKET;
const queueKey = process.env.CLOUD_QUEUE_KEY ?? "queue.json";
const token = process.env.IG_ACCESS_TOKEN;
const version = process.env.GRAPH_API_VERSION ?? "v21.0";
const metrics = (process.env.IG_INSIGHT_METRICS ?? "views,reach,saved,shares")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const num = (v) => (v == null ? "—" : Number(v).toLocaleString());

const s3 = makeS3(region);
const queue = await getJson(s3, { bucket, key: queueKey });
let { rows, scopeHint } = await fetchStats({
  token,
  version,
  metrics,
  entries: queue?.entries ?? [],
});

if (days) {
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  rows = rows.filter((r) => r.date >= cutoff);
}

if (rows.length === 0) {
  console.log("No published Reels yet. Stats appear here once the poster has run.");
  process.exit(0);
}

console.log("");
for (const r of rows) {
  console.log(`${r.date}  ${r.slug}`);
  console.log(
    `   views ${num(r.views)}  reach ${num(r.reach)}  likes ${num(r.likes)}` +
      `  comments ${num(r.comments)}  saves ${num(r.saved)}  shares ${num(r.shares)}`,
  );
  if (r.permalink) console.log(`   ${r.permalink}`);
}

// Summary + best performer (by views, else reach, else likes).
const rank = (r) => r.views ?? r.reach ?? r.likes ?? 0;
const best = rows.reduce((a, b) => (rank(b) > rank(a) ? b : a));
console.log(
  `\n${rows.length} posted — totals: views ${num(sum(rows, "views"))}, ` +
    `likes ${num(sum(rows, "likes"))}, comments ${num(sum(rows, "comments"))}`,
);
console.log(`Top performer: ${best.slug} (${num(rank(best))})`);

// Reels vs static, the split that drives every format decision on this account.
const reels = rows.filter((r) => r.isReel);
const statics = rows.filter((r) => !r.isReel);
if (reels.length && statics.length) {
  const per = (a) => (sum(a, "views") / a.length).toFixed(1);
  console.log(`Reels ${reels.length} avg ${per(reels)} — static ${statics.length} avg ${per(statics)}`);
}

// Data access lapses 60 days after authorization and takes insights with it.
const health = await tokenHealth({ token, version });
if (health.ok && health.dataAccessExpiresInDays != null && health.dataAccessExpiresInDays < 21) {
  console.log(
    `\n⚠️  Token data access expires in ${health.dataAccessExpiresInDays} days ` +
      `(${health.dataAccessExpiresOn}). Re-authorize before then or stats and posting stop.`,
  );
}

if (scopeHint) {
  console.log(
    "\n⚠️  Reach/views/saves/shares need the `instagram_manage_insights` permission.\n" +
      "   Regenerate the token in the Graph API Explorer with that scope added, then\n" +
      "   run `npm run ig:setup` again. Likes/comments work without it.",
  );
}
