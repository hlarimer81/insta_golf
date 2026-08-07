#!/usr/bin/env node
/**
 * Pull performance stats for posted Reels from the Instagram Graph API.
 *
 *   npm run stats
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

const region = process.env.AWS_REGION;
const bucket = process.env.S3_BUCKET;
const queueKey = process.env.CLOUD_QUEUE_KEY ?? "queue.json";
const token = process.env.IG_ACCESS_TOKEN;
const version = process.env.GRAPH_API_VERSION ?? "v21.0";
const insightMetrics = (process.env.IG_INSIGHT_METRICS ?? "views,reach,saved,shares")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Graph GET that returns errors instead of throwing, so one bad call doesn't
// sink the whole report.
async function gget(path, params) {
  const qs = new URLSearchParams({ ...params, access_token: token });
  const res = await fetch(`https://graph.facebook.com/${version}/${path}?${qs}`);
  const json = await res.json();
  return { ok: res.ok && !json.error, json, error: json.error };
}

const num = (v) => (v == null ? "—" : Number(v).toLocaleString());

const s3 = makeS3(region);
const queue = await getJson(s3, { bucket, key: queueKey });
const published = (queue?.entries ?? [])
  .filter((e) => e.status === "published" && e.mediaId)
  .sort((a, b) => (a.postedAt ?? a.publishAt).localeCompare(b.postedAt ?? b.publishAt));

if (published.length === 0) {
  console.log("No published Reels yet. Stats appear here once the poster has run.");
  process.exit(0);
}

let scopeHint = false;
const totals = { views: 0, reach: 0, likes: 0, comments: 0, saved: 0, shares: 0 };
const rows = [];

for (const e of published) {
  const media = await gget(e.mediaId, {
    fields: "permalink,timestamp,like_count,comments_count",
  });

  // Insights: try the configured metrics, fall back to reach-only if the set
  // is rejected (Instagram occasionally renames metrics).
  let insights = {};
  let r = await gget(`${e.mediaId}/insights`, { metric: insightMetrics.join(",") });
  if (!r.ok) {
    const r2 = await gget(`${e.mediaId}/insights`, { metric: "reach" });
    if (r2.ok) r = r2;
    else if (/permission|insights/i.test(r.error?.message ?? "")) scopeHint = true;
  }
  if (r.ok) for (const m of r.json.data ?? []) insights[m.name] = m.values?.[0]?.value;

  const row = {
    date: (e.postedAt ?? media.json.timestamp ?? e.publishAt).slice(0, 10),
    slug: e.slug,
    permalink: media.json.permalink,
    views: insights.views,
    reach: insights.reach,
    likes: media.json.like_count,
    comments: media.json.comments_count,
    saved: insights.saved,
    shares: insights.shares,
  };
  rows.push(row);
  for (const k of Object.keys(totals)) if (typeof row[k] === "number") totals[k] += row[k];
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
console.log(`\n${rows.length} posted — totals: views ${num(totals.views)}, likes ${num(totals.likes)}, comments ${num(totals.comments)}`);
console.log(`Top performer: ${best.slug} (${num(rank(best))})`);

if (scopeHint) {
  console.log(
    "\n⚠️  Reach/views/saves/shares need the `instagram_manage_insights` permission.\n" +
      "   Regenerate the token in the Graph API Explorer with that scope added, then\n" +
      "   run `npm run ig:setup` again. Likes/comments work without it.",
  );
}
