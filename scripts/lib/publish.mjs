/**
 * Local publish engine — uploads a rendered Reel to S3 and posts it to
 * Instagram. Used by `npm run schedule -- run --live`.
 *
 * The reusable primitives live in ./instagram.mjs and ./s3.mjs so the cloud
 * Lambda can share them without dragging in filesystem code.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { makeS3, uploadFile, presignGet } from "./s3.mjs";
import { buildCaption, graphPublish } from "./instagram.mjs";

export { buildCaption } from "./instagram.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const scriptsDir = join(root, "scripts");
const outDir = join(root, "out");

function requireEnv(...names) {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) {
    throw new Error(`Missing required env var(s): ${missing.join(", ")}. See .env.example.`);
  }
}

export async function publishReel({ slug, dryRun = true }) {
  const scriptPath = join(scriptsDir, `${slug}.json`);
  const videoPath = join(outDir, `${slug}.mp4`);
  if (!existsSync(scriptPath)) throw new Error(`No approved script scripts/${slug}.json`);
  if (!existsSync(videoPath)) {
    throw new Error(`Not rendered yet: out/${slug}.mp4 — run "npm run render".`);
  }

  const reel = JSON.parse(readFileSync(scriptPath, "utf8"));
  const caption = buildCaption(reel);

  if (dryRun) {
    return { dryRun: true, slug, videoPath, caption, mediaId: null };
  }

  requireEnv("AWS_REGION", "S3_BUCKET", "IG_USER_ID", "IG_ACCESS_TOKEN");
  const region = process.env.AWS_REGION;
  const bucket = process.env.S3_BUCKET;
  const key = `${process.env.S3_PREFIX ?? "reels/"}${slug}.mp4`;

  const s3 = makeS3(region);
  await uploadFile(s3, { bucket, key, path: videoPath });
  const videoUrl = await presignGet(s3, {
    bucket,
    key,
    ttl: parseInt(process.env.S3_URL_TTL ?? "3600", 10),
  });
  const mediaId = await graphPublish({
    igUser: process.env.IG_USER_ID,
    token: process.env.IG_ACCESS_TOKEN,
    videoUrl,
    caption,
    version: process.env.GRAPH_API_VERSION ?? "v21.0",
    pollAttempts: parseInt(process.env.IG_POLL_ATTEMPTS ?? "30", 10),
    pollIntervalMs: parseInt(process.env.IG_POLL_INTERVAL_MS ?? "10000", 10),
  });

  return { dryRun: false, slug, videoUrl, caption, mediaId };
}
