#!/usr/bin/env node
/**
 * Manage the cloud posting queue (S3) that the daily Lambda reads.
 *
 *   npm run enqueue -- <slug> --at 2026-08-10T09:00              # queue a Reel
 *   npm run enqueue -- <slug> --at 2026-08-10T09:00 --carousel   # queue a carousel
 *   npm run enqueue -- <slug> --at 2026-08-10T09:00 --meme       # queue a meme
 *   npm run enqueue -- list                                      # show the queue
 *   npm run enqueue -- remove <slug> [--type meme]               # unqueue it
 *
 * Adding uploads the media to S3 and appends an entry (caption baked in).
 * Reels use out/<slug>.mp4; carousels use out/carousels/<slug>/*.png;
 * memes use out/memes/<slug>.png.
 * Per the no-review model, add skips the review gate — it only requires that
 * the media is rendered. Reads AWS creds/config from .env.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
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
} else if (args[0] === "remove") {
  await cmdRemove(args.slice(1));
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
  const typeIcon = { carousel: "🎠", meme: "😄", reel: "🎬" };
  const sorted = [...queue.entries].sort((a, b) => a.publishAt.localeCompare(b.publishAt));
  for (const e of sorted) {
    const kind = typeIcon[e.type ?? "reel"] ?? "🎬";
    const extra = e.mediaId ? `  media ${e.mediaId}` : e.error ? `  (${e.error})` : "";
    console.log(`${icon[e.status] ?? "•"} ${kind} ${e.publishAt}  ${e.slug}${extra}`);
  }
  const counts = sorted.reduce((m, e) => ((m[e.status] = (m[e.status] || 0) + 1), m), {});
  console.log(
    `\n${sorted.length} total — ` +
      Object.entries(counts)
        .map(([k, v]) => `${v} ${k}`)
        .join(", "),
  );
}

// Drop pending entries from the queue (e.g. to re-stage a post in another
// format). Published entries are left alone — they're the posting record.
async function cmdRemove(args) {
  const slug = args.find((a) => !a.startsWith("--"));
  const tIdx = args.indexOf("--type");
  const type = tIdx >= 0 ? args[tIdx + 1] : null;
  if (!slug) {
    console.error("Usage: npm run enqueue -- remove <slug> [--type reel|carousel|meme]");
    process.exit(1);
  }

  const queue = await getJson(s3, { bucket, key: queueKey });
  if (!queue?.entries?.length) {
    console.error("Cloud queue is empty.");
    process.exit(1);
  }

  const doomed = queue.entries.filter(
    (e) => e.slug === slug && (!type || (e.type ?? "reel") === type) && e.status !== "published",
  );
  if (doomed.length === 0) {
    const published = queue.entries.some((e) => e.slug === slug && e.status === "published");
    console.error(
      published
        ? `"${slug}" is already published — leaving it in the queue as the posting record.`
        : `Nothing pending matches "${slug}"${type ? ` (type ${type})` : ""}.`,
    );
    process.exit(1);
  }

  queue.entries = queue.entries.filter((e) => !doomed.includes(e));
  await putJson(s3, { bucket, key: queueKey, data: queue });
  for (const e of doomed) {
    console.log(`🗑  Removed ${e.type ?? "reel"} "${e.slug}" (was ${e.publishAt})`);
  }
  console.log(`   ${queue.entries.length} entries left in s3://${bucket}/${queueKey}`);
}

async function cmdAdd(args) {
  const isCarousel = args.includes("--carousel");
  const isMeme = args.includes("--meme");
  if (isCarousel && isMeme) {
    console.error("Pass either --carousel or --meme, not both.");
    process.exit(1);
  }
  const rest = args.filter((a) => a !== "--carousel" && a !== "--meme");
  const [slug, ...flags] = rest;
  let at;
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] === "--at") at = flags[++i];
  }
  if (!slug || !at) {
    console.error(
      "Usage:\n" +
        "  npm run enqueue -- <slug> --at <ISO> [--carousel | --meme]\n" +
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
  if (!existsSync(scriptPath)) {
    console.error(`No script scripts/${slug}.json`);
    process.exit(1);
  }
  const reel = JSON.parse(readFileSync(scriptPath, "utf8"));
  const caption = buildCaption(reel);

  // Upload the media and build the type-specific fields.
  const entry = {
    slug,
    type: isCarousel ? "carousel" : isMeme ? "meme" : "reel",
    publishAt: when.toISOString(),
    status: "pending",
    caption,
    mediaId: null,
    postedAt: null,
    error: null,
  };

  if (isCarousel) {
    const slidesDir = join(outDir, "carousels", slug);
    const slides = existsSync(slidesDir)
      ? readdirSync(slidesDir).filter((f) => f.endsWith(".png")).sort()
      : [];
    if (slides.length === 0) {
      console.error(`No slides in out/carousels/${slug}/ — run "npm run render:carousel -- ${slug}" first.`);
      process.exit(1);
    }
    entry.mediaKeys = [];
    for (const file of slides) {
      const key = `carousels/${slug}/${file}`;
      console.log(`Uploading ${file} → s3://${bucket}/${key} …`);
      await uploadFile(s3, {
        bucket,
        key,
        path: join(slidesDir, file),
        contentType: "image/png",
      });
      entry.mediaKeys.push(key);
    }
  } else if (isMeme) {
    const imagePath = join(outDir, "memes", `${slug}.png`);
    if (!existsSync(imagePath)) {
      console.error(
        `Not rendered: out/memes/${slug}.png — run "npm run render:meme -- ${slug}" first.`,
      );
      process.exit(1);
    }
    const key = `memes/${slug}.png`;
    console.log(`Uploading out/memes/${slug}.png → s3://${bucket}/${key} …`);
    await uploadFile(s3, { bucket, key, path: imagePath, contentType: "image/png" });
    entry.imageKey = key;
  } else {
    const videoPath = join(outDir, `${slug}.mp4`);
    if (!existsSync(videoPath)) {
      console.error(`Not rendered: out/${slug}.mp4 — run "npm run render" first.`);
      process.exit(1);
    }
    const key = `${prefix}${slug}.mp4`;
    console.log(`Uploading out/${slug}.mp4 → s3://${bucket}/${key} …`);
    await uploadFile(s3, { bucket, key, path: videoPath });
    entry.videoKey = key;
  }

  const queue = (await getJson(s3, { bucket, key: queueKey })) ?? { entries: [] };
  if (queue.entries.some((e) => e.slug === slug && e.type === entry.type && e.status !== "failed")) {
    console.error(`"${slug}" (${entry.type}) is already in the cloud queue.`);
    process.exit(1);
  }
  queue.entries.push(entry);
  await putJson(s3, { bucket, key: queueKey, data: queue });

  console.log(`✅ Enqueued ${entry.type} "${slug}" for ${when.toISOString()}`);
  console.log(`   cloud queue: s3://${bucket}/${queueKey}`);
}
