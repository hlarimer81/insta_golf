#!/usr/bin/env node
/**
 * Turn an approved golf-babies sketch into a video with fal.ai.
 *
 *   npm run render:babies -- <slug>
 *   npm run render:babies -- <slug> --resolution 1080p
 *   npm run render:babies -- <slug> --force        # pay for a fresh take
 *   npm run render:babies -- <slug> --prompt-only  # print the prompt, spend nothing
 *
 * Writes out/<slug>.mp4 — the same place `npm run render` puts a Reel — so the
 * clip enqueues exactly like one:  npm run enqueue -- <slug> --at <ISO>
 *
 * Generation takes minutes and costs real money per clip (check fal.ai/pricing
 * for the model), so the request is recorded on the script before waiting on
 * it. If this is interrupted, re-running picks the same request back up rather
 * than paying for a second one.
 *
 * Model: FAL_VIDEO_MODEL, default bytedance/seedance-2.0/text-to-video. Any
 * fal-ai/veo3.1* endpoint also works (it caps clips at 8s).
 *
 * Requires FAL_KEY in .env.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { videoPrompt } from "./lib/babies.mjs";

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

// ---- args -----------------------------------------------------------------
const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith("--"));
const rIdx = args.indexOf("--resolution");
const resolution = rIdx >= 0 ? args[rIdx + 1] : process.env.FAL_VIDEO_RESOLUTION ?? "720p";
const force = args.includes("--force");
const promptOnly = args.includes("--prompt-only");
if (!slug) {
  console.error("Usage: npm run render:babies -- <slug> [--resolution 720p|1080p] [--force] [--prompt-only]");
  process.exit(1);
}

// Approved scripts only: drafts haven't been through `npm run review`.
const scriptPath = join(scriptsDir, `${slug}.json`);
if (!existsSync(scriptPath)) {
  const draft = existsSync(join(scriptsDir, "drafts", `${slug}.json`));
  console.error(
    draft
      ? `scripts/drafts/${slug}.json hasn't been approved yet — run "npm run review" first.`
      : `No script scripts/${slug}.json`,
  );
  process.exit(1);
}
const sketch = JSON.parse(readFileSync(scriptPath, "utf8"));
if (sketch.kind !== "babies") {
  console.error(`${slug} is a ${sketch.kind ?? "tip"} script — render it with "npm run render".`);
  process.exit(1);
}

const prompt = videoPrompt(sketch);
if (promptOnly) {
  console.log(prompt);
  process.exit(0);
}
if (!process.env.FAL_KEY) {
  console.error("FAL_KEY is not set in .env. Get a key at https://fal.ai and add:\n  FAL_KEY=...");
  process.exit(1);
}

const outPath = join(outDir, `${slug}.mp4`);
if (existsSync(outPath) && !force) {
  console.log(`out/${slug}.mp4 already exists. Pass --force to generate (and pay for) a new take.`);
  process.exit(0);
}

const model = process.env.FAL_VIDEO_MODEL ?? "bytedance/seedance-2.0/text-to-video";
const headers = { Authorization: `Key ${process.env.FAL_KEY}`, "Content-Type": "application/json" };

// The two families take duration differently: Seedance wants "4".."15", Veo
// wants "4s" | "6s" | "8s".
function inputFor(model) {
  const base = { prompt, aspect_ratio: "9:16", resolution, generate_audio: true };
  if (model.includes("veo")) {
    const s = sketch.seconds <= 4 ? 4 : sketch.seconds <= 6 ? 6 : 8;
    return { ...base, duration: `${s}s` };
  }
  // H264, the codec every other Reel this pipeline posts already uses.
  return { ...base, duration: String(sketch.seconds), codec: "H264" };
}

// ---- submit (or resume) ---------------------------------------------------
let request = !force && sketch.falRequest?.model === model ? sketch.falRequest : null;
if (request) {
  console.log(`↻  Resuming fal request ${request.id} for "${slug}"…`);
} else {
  console.log(`👶👶  Generating "${slug}" (${sketch.seconds}s, ${resolution}) via ${model}…`);
  console.log(`   prompt: ${prompt.slice(0, 160)}…`);
  const res = await fetch(`https://queue.fal.run/${model}`, {
    method: "POST",
    headers,
    body: JSON.stringify(inputFor(model)),
  });
  const data = await res.json();
  if (!res.ok || !data.request_id) {
    console.error("fal.ai submit failed:", JSON.stringify(data.detail ?? data.error ?? data));
    process.exit(1);
  }
  request = { model, id: data.request_id, statusUrl: data.status_url, responseUrl: data.response_url };
  // Record it before waiting, so an interrupted run resumes instead of re-paying.
  sketch.falRequest = request;
  writeFileSync(scriptPath, JSON.stringify(sketch, null, 2) + "\n");
}

// ---- wait -----------------------------------------------------------------
const deadline = Date.now() + 20 * 60 * 1000;
let last = "";
for (;;) {
  const res = await fetch(request.statusUrl, { headers });
  const status = await res.json();
  if (status.status === "COMPLETED") break;
  if (!res.ok || !["IN_QUEUE", "IN_PROGRESS"].includes(status.status)) {
    console.error("fal.ai status check failed:", JSON.stringify(status.detail ?? status));
    process.exit(1);
  }
  if (status.status !== last) {
    console.log(`   ${status.status === "IN_QUEUE" ? "queued" : "generating"}…`);
    last = status.status;
  }
  if (Date.now() > deadline) {
    console.error(`Still not done after 20 minutes. Re-run the same command later to pick it back up.`);
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 10_000));
}

// A COMPLETED request can still have failed — a safety refusal, for one — and
// the reason only shows up in the result.
const result = await fetch(request.responseUrl, { headers });
const data = await result.json();
if (!result.ok || !data.video?.url) {
  // Clear the dead request so the next run submits a fresh one.
  delete sketch.falRequest;
  writeFileSync(scriptPath, JSON.stringify(sketch, null, 2) + "\n");
  console.error("fal.ai generation failed:", JSON.stringify(data.detail ?? data.error ?? data));
  console.error("Edit the sketch's setting/action/dialogue if it was refused, then re-run.");
  process.exit(1);
}

// ---- download -------------------------------------------------------------
mkdirSync(outDir, { recursive: true });
const video = await fetch(data.video.url);
writeFileSync(outPath, Buffer.from(await video.arrayBuffer()));

sketch.videoModel = model;
delete sketch.falRequest;
writeFileSync(scriptPath, JSON.stringify(sketch, null, 2) + "\n");

console.log(`✅  Saved out/${slug}.mp4 — watch it before you queue it.`);
console.log(`   Then:  npm run enqueue -- ${slug} --at <ISO>`);
