#!/usr/bin/env node
/**
 * Add AI backgrounds to every PENDING post in the cloud queue and overwrite
 * their media in S3 in place (queue entries/keys are unchanged, so the daily
 * poster just posts the new versions). Reels get a Ken-Burns background;
 * carousels get a scrimmed background. Published posts are left alone, and
 * posts that already have a background are re-rendered without a new fal call.
 *
 *   npm run refresh:bg
 *
 * Needs FAL_KEY + ANTHROPIC_API_KEY + AWS creds in .env.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, basename } from "node:path";
import { makeS3, getJson, uploadFile } from "./lib/s3.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scriptsDir = join(root, "scripts");
const outDir = join(root, "out");
try {
  process.loadEnvFile(join(root, ".env"));
} catch {
  /* ignore */
}

const bucket = process.env.S3_BUCKET;
const s3 = makeS3(process.env.AWS_REGION);

function run(args) {
  const res = spawnSync("node", args, {
    cwd: root,
    stdio: ["ignore", "ignore", "pipe"],
    encoding: "utf8",
  });
  if (res.status !== 0) throw new Error((res.stderr || "").trim().slice(-500) || `failed: ${args.join(" ")}`);
}

const queue = await getJson(s3, { bucket, key: process.env.CLOUD_QUEUE_KEY ?? "queue.json" });
const pending = queue.entries.filter((e) => e.status === "pending");
console.log(`Refreshing ${pending.length} pending posts with backgrounds…\n`);

let done = 0;
for (const e of pending) {
  const type = e.type ?? "reel";
  const script = JSON.parse(readFileSync(join(scriptsDir, `${e.slug}.json`), "utf8"));
  try {
    // 1. Background (skip the fal call if one is already set + present).
    const haveBg = script.brollSrc && existsSync(join(root, "public", script.brollSrc));
    if (!haveBg) {
      console.log(`🎨 bg      ${e.slug}`);
      run(["scripts/bg.mjs", e.slug]);
    } else {
      console.log(`•  bg kept ${e.slug}`);
    }

    // 2. Re-render + overwrite the S3 media at the entry's existing key(s).
    if (type === "carousel") {
      console.log(`🎠 render  ${e.slug}`);
      run(["scripts/render-carousel.mjs", e.slug]);
      for (const key of e.mediaKeys) {
        await uploadFile(s3, {
          bucket,
          key,
          path: join(outDir, "carousels", e.slug, basename(key)),
          contentType: "image/png",
        });
      }
    } else {
      console.log(`🎬 render  ${e.slug}`);
      run(["scripts/render.mjs", `scripts/${e.slug}.json`]);
      await uploadFile(s3, { bucket, key: e.videoKey, path: join(outDir, `${e.slug}.mp4`) });
    }

    done++;
    console.log(`   ✅ replaced ${e.slug} (${done}/${pending.length})\n`);
  } catch (err) {
    console.error(`   ❌ ${e.slug}: ${err.message}\n`);
  }
}

console.log(`Done: ${done}/${pending.length} pending posts now have backgrounds.`);
