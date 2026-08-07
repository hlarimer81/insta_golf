#!/usr/bin/env node
/**
 * Manage the cloud posting queue (S3) that the daily Lambda reads.
 *
 *   npm run enqueue -- <slug> --at 2026-08-10T09:00   # queue a rendered Reel
 *   npm run enqueue -- list                            # show the queue + status
 *
 * Adding uploads out/<slug>.mp4 to S3 and appends an entry (caption baked in).
 * Per the no-review model, add skips the review gate — it only requires that
 * the Reel is rendered. Reads AWS creds/config from .env.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { makeS3, uploadFile, getJson, putJson } from "./lib/s3.mjs";
import { buildCaption } from "./lib/instagram.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scriptsDir = join(root, "scripts");
const outDir = join(root, "out");

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

const region = process.env.AWS_REGION;
const bucket = process.env.S3_BUCKET;
const prefix = process.env.S3_PREFIX ?? "reels/";
const queueKey = process.env.CLOUD_QUEUE_KEY ?? "queue.json";
const s3 = makeS3(region);

const args = process.argv.slice(2);
if (args[0] === "list") {
  await cmdList();
} else {
  await cmdAdd(args);
}

async function cmdList() {
  const queue = await getJson(s3, { bucket, key: queueKey });
  if (!queue || !queue.entries?.length) {
    console.log("Cloud queue is empty. Add one with: npm run enqueue -- <slug> --at <ISO>");
    return;
  }
  const icon = { pending: "⏳", published: "✅", failed: "❌" };
  const sorted = [...queue.entries].sort((a, b) => a.publishAt.localeCompare(b.publishAt));
  for (const e of sorted) {
    const extra = e.mediaId ? `  media ${e.mediaId}` : e.error ? `  (${e.error})` : "";
    console.log(`${icon[e.status] ?? "•"}  ${e.publishAt}  ${e.slug}${extra}`);
  }
  const counts = sorted.reduce((m, e) => ((m[e.status] = (m[e.status] || 0) + 1), m), {});
  console.log(
    `\n${sorted.length} total — ` +
      Object.entries(counts)
        .map(([k, v]) => `${v} ${k}`)
        .join(", "),
  );
}

async function cmdAdd(args) {
  const [slug, ...rest] = args;
  let at;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--at") at = rest[++i];
  }
  if (!slug || !at) {
    console.error(
      "Usage:\n" +
        "  npm run enqueue -- <slug> --at <ISO date/time>\n" +
        "  npm run enqueue -- list",
    );
    process.exit(1);
  }
  const when = new Date(at);
  if (isNaN(when)) {
    console.error(`Couldn't parse --at "${at}". Use e.g. 2026-08-10T09:00`);
    process.exit(1);
  }

  const scriptPath = join(scriptsDir, `${slug}.json`);
  const videoPath = join(outDir, `${slug}.mp4`);
  if (!existsSync(scriptPath)) {
    console.error(`No script scripts/${slug}.json`);
    process.exit(1);
  }
  if (!existsSync(videoPath)) {
    console.error(`Not rendered: out/${slug}.mp4 — run "npm run render" first.`);
    process.exit(1);
  }

  const videoKey = `${prefix}${slug}.mp4`;
  const reel = JSON.parse(readFileSync(scriptPath, "utf8"));
  const caption = buildCaption(reel);

  console.log(`Uploading out/${slug}.mp4 → s3://${bucket}/${videoKey} …`);
  await uploadFile(s3, { bucket, key: videoKey, path: videoPath });

  const queue = (await getJson(s3, { bucket, key: queueKey })) ?? { entries: [] };
  if (queue.entries.some((e) => e.slug === slug && e.status !== "failed")) {
    console.error(`"${slug}" is already in the cloud queue.`);
    process.exit(1);
  }
  queue.entries.push({
    slug,
    publishAt: when.toISOString(),
    status: "pending",
    caption,
    videoKey,
    mediaId: null,
    postedAt: null,
    error: null,
  });
  await putJson(s3, { bucket, key: queueKey, data: queue });

  console.log(`✅ Enqueued "${slug}" for ${when.toISOString()}`);
  console.log(`   cloud queue: s3://${bucket}/${queueKey}`);
}
