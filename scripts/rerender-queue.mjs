#!/usr/bin/env node
/**
 * Score queued-but-unpublished Reels with a music bed and re-render them.
 *
 *   npm run rerender -- --dry-run   # show the plan, change nothing
 *   npm run rerender -- --limit 1   # do the earliest N only
 *   npm run rerender -- --force     # redo Reels already carrying their bed
 *   npm run rerender                # assign, render, re-upload
 *
 * Unlike a caption, audio is not metadata: it is baked into the MP4 at render
 * time. A queued post already has a rendered video sitting in S3, so adding
 * music means re-rendering it and replacing that object. Budget a couple of
 * minutes per Reel.
 *
 * Each script's `audioSrc` is written back to its JSON, so the bed is recorded
 * where the script lives and a later re-render reproduces it rather than
 * picking again. Video keys and captions are untouched, so the queue itself
 * needs no edit -- the object at the existing key is simply replaced.
 *
 * Pending reels only. Published posts are already on Instagram, and memes and
 * carousels are stills with no audio track.
 *
 * Env: AWS_REGION, S3_BUCKET.
 */
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { makeS3, getJson, uploadFile } from "./lib/s3.mjs";
import { availableTracks, pickTrack } from "./lib/audio.mjs";

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
const limitAt = process.argv.indexOf("--limit");
const limit = limitAt >= 0 ? parseInt(process.argv[limitAt + 1], 10) : Infinity;
const force = process.argv.includes("--force");
const bucket = process.env.S3_BUCKET;
const queueKey = process.env.CLOUD_QUEUE_KEY ?? "queue.json";
const scriptsDir = join(root, "scripts");
const outDir = join(root, "out");

const tracks = availableTracks();
if (!tracks.length) {
  console.error(
    "No tracks in public/audio/ and BOGEY_AUDIO_TRACKS is unset.\n" +
      'Run "npm run beds" to generate them.',
  );
  process.exit(1);
}

const s3 = makeS3(process.env.AWS_REGION);
const queue = await getJson(s3, { bucket, key: queueKey });
const pending = (queue?.entries ?? []).filter(
  (e) => e.status === "pending" && (e.type ?? "reel") === "reel",
);
if (!pending.length) {
  console.error("No pending reels in the queue.");
  process.exit(1);
}

console.log(`\n${tracks.length} bed(s): ${tracks.join(", ")}`);
console.log(`${pending.length} pending reel(s) to score.\n`);

// Earliest publish date first, so a partial run scores the posts that go out
// soonest rather than an arbitrary slice of the month.
pending.sort((a, b) => a.publishAt.localeCompare(b.publishAt));

const plan = [];
for (const entry of pending) {
  if (plan.length >= limit) break;
  const scriptPath = join(scriptsDir, `${entry.slug}.json`);
  if (!existsSync(scriptPath)) {
    console.log(`⚠️  ${entry.slug}: no script, skipping`);
    continue;
  }
  const reel = JSON.parse(readFileSync(scriptPath, "utf8"));
  const track = pickTrack(entry.slug, tracks);
  // Already scored with this bed: skip, so an interrupted run resumes instead
  // of re-rendering from the top. Forty minutes of work should be restartable.
  if (reel.audioSrc === track && !force) {
    console.log(`✓  ${entry.slug.padEnd(44)} already scored with ${track}`);
    continue;
  }
  plan.push({ entry, scriptPath, reel, track, was: reel.audioSrc });
  console.log(
    `${entry.publishAt.slice(0, 10)}  ${entry.slug.padEnd(44)} ` +
      `${reel.audioSrc ?? "(silent)"} → ${track}`,
  );
}

if (!plan.length) {
  console.log("\nEvery pending Reel already carries its bed. Nothing to do.");
  process.exit(0);
}

if (dryRun) {
  console.log("\n--dry-run: nothing rendered, nothing uploaded.");
  process.exit(0);
}

let done = 0;
const failed = [];
for (const [i, p] of plan.entries()) {
  const n = `[${i + 1}/${plan.length}]`;
  // Record the bed before rendering, so the render reads it from the script.
  writeFileSync(p.scriptPath, JSON.stringify({ ...p.reel, audioSrc: p.track }, null, 2) + "\n");

  console.log(`\n${n} 🎬  rendering ${p.entry.slug} with ${p.track}…`);
  const r = spawnSync("node", [join(scriptsDir, "render.mjs"), p.scriptPath], {
    cwd: root,
    stdio: "pipe",
    encoding: "utf8",
  });
  const videoPath = join(outDir, `${p.entry.slug}.mp4`);
  if (r.status !== 0 || !existsSync(videoPath)) {
    // Put the script back the way it was: a recorded bed whose render failed
    // would make the next run think the work was already done.
    writeFileSync(p.scriptPath, JSON.stringify({ ...p.reel, audioSrc: p.was }, null, 2) + "\n");
    failed.push(p.entry.slug);
    console.error(`${n} ✗  render failed, script reverted`);
    console.error((r.stderr || "").split("\n").slice(-5).join("\n"));
    continue;
  }

  console.log(`${n} ☁️   uploading → s3://${bucket}/${p.entry.videoKey}`);
  await uploadFile(s3, { bucket, key: p.entry.videoKey, path: videoPath });
  done++;
}

console.log(`\n✅  Scored and re-uploaded ${done} of ${plan.length} Reel(s).`);
if (failed.length) {
  console.log(`✗  Failed (left silent, scripts unchanged): ${failed.join(", ")}`);
  process.exit(1);
}
