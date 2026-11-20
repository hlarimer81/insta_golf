#!/usr/bin/env node
/**
 * Turn an approved golf-babies sketch into a video with fal.ai or Gemini.
 *
 *   npm run render:babies -- <slug>
 *   npm run render:babies -- <slug> --resolution 1080p
 *   npm run render:babies -- <slug> --force        # pay for a fresh take
 *   npm run render:babies -- <slug> --prompt-only  # print the prompt, spend nothing
 *   npm run render:babies -- <slug> --model gemini-omni-1.2-flash --out out/omni/<slug>.mp4
 *
 * Writes out/<slug>.mp4 — the same place `npm run render` puts a Reel — so the
 * clip enqueues exactly like one:  npm run enqueue -- <slug> --at <ISO>
 *
 * Generation takes minutes and costs real money per clip (check fal.ai/pricing
 * for the model), so the request is recorded on the script before waiting on
 * it. If this is interrupted, re-running picks the same request back up rather
 * than paying for a second one.
 *
 * Model: --model, else BABIES_VIDEO_MODEL, else FAL_VIDEO_MODEL, else
 * DEFAULT_VIDEO_MODEL in lib/babies.mjs (gemini-omni-1.2-flash). A gemini-omni-*
 * model goes to Google's Gemini API (scripts/lib/omni.mjs); anything else is a
 * fal.ai endpoint, e.g. bytedance/seedance-2.0/text-to-video (the default until
 * 2026-11-20, at about four times the price) or fal-ai/veo3.1* (max 8s).
 *
 * --out <path> writes the clip somewhere other than out/<slug>.mp4 and leaves
 * the script's recorded videoModel alone: for trying a model on a sketch that
 * is already rendered and queued, without touching the queued take.
 *
 * Requires FAL_KEY in .env, or GEMINI_API_KEY for a gemini-omni-* model.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { videoPrompt, DEFAULT_VIDEO_MODEL } from "./lib/babies.mjs";
import { generateOmni } from "./lib/omni.mjs";

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
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
// The first bare argument that isn't a flag's value.
const valued = new Set(["--resolution", "--model", "--out"]);
const slug = args.find((a, i) => !a.startsWith("--") && !valued.has(args[i - 1]));
const resolution = flag("resolution") ?? process.env.FAL_VIDEO_RESOLUTION ?? "720p";
const force = args.includes("--force");
const promptOnly = args.includes("--prompt-only");
const model =
  flag("model") ||
  process.env.BABIES_VIDEO_MODEL ||
  process.env.FAL_VIDEO_MODEL ||
  DEFAULT_VIDEO_MODEL;
const isGemini = model.startsWith("gemini-omni");
const customOut = flag("out");
if (!slug) {
  console.error(
    "Usage: npm run render:babies -- <slug> [--resolution 720p|1080p] [--model M] [--out PATH] [--force] [--prompt-only]",
  );
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
if (isGemini ? !process.env.GEMINI_API_KEY : !process.env.FAL_KEY) {
  console.error(
    isGemini
      ? "GEMINI_API_KEY is not set in .env. Make one at https://aistudio.google.com/apikey and add:\n  GEMINI_API_KEY=..."
      : "FAL_KEY is not set in .env. Get a key at https://fal.ai and add:\n  FAL_KEY=...",
  );
  process.exit(1);
}

const outPath = customOut ? resolve(customOut) : join(outDir, `${slug}.mp4`);
if (existsSync(outPath) && !force) {
  console.log(`${outPath} already exists. Pass --force to generate (and pay for) a new take.`);
  process.exit(0);
}

// ---- Gemini Omni Flash ----------------------------------------------------
if (isGemini) {
  // Where an in-flight interaction id is kept, so an interrupted run resumes
  // instead of paying twice: on the script for a real render, beside the
  // output for an --out trial, so a trial never edits a queued script.
  const reqPath = `${outPath}.request.json`;
  const saved = customOut
    ? existsSync(reqPath) && JSON.parse(readFileSync(reqPath, "utf8"))
    : sketch.geminiRequest;
  const resume = !force && saved?.model === model ? saved.id : undefined;
  const record = (req) => {
    if (customOut) {
      if (req) writeFileSync(reqPath, JSON.stringify(req) + "\n");
      else if (existsSync(reqPath)) unlinkSync(reqPath);
      return;
    }
    if (req) sketch.geminiRequest = req;
    else delete sketch.geminiRequest;
    writeFileSync(scriptPath, JSON.stringify(sketch, null, 2) + "\n");
  };

  console.log(
    resume
      ? `↻  Resuming Gemini interaction ${resume} for "${slug}"…`
      : `👶👶  Generating "${slug}" (${sketch.seconds}s, ${resolution}) via ${model}…`,
  );
  mkdirSync(dirname(outPath), { recursive: true });
  const started = Date.now();
  let mp4;
  try {
    mp4 = await generateOmni({
      key: process.env.GEMINI_API_KEY,
      model,
      prompt,
      seconds: sketch.seconds,
      resolution,
      resume,
      onSubmit: (id) => record({ model, id }),
    });
  } catch (err) {
    // A timeout is worth resuming; anything else is dead, so clear it.
    if (!err.resumable) record(null);
    console.error(`Gemini generation failed: ${err.message}`);
    if (/RESOURCE_EXHAUSTED/.test(err.message)) {
      console.error(
        "The key's Google project has no quota for this model: Omni Flash has no free tier, so\n" +
          "billing must be on (aistudio.google.com → the key's project → Set up billing), or a\n" +
          "rate/spend limit was hit. Nothing was charged.",
      );
    } else if (!err.resumable) {
      console.error("Edit the sketch's setting/action/dialogue if it was refused, then re-run.");
    }
    process.exit(1);
  }
  writeFileSync(outPath, mp4);
  record(null);
  if (!customOut) {
    sketch.videoModel = model;
    writeFileSync(scriptPath, JSON.stringify(sketch, null, 2) + "\n");
  }
  const secs = Math.round((Date.now() - started) / 1000);
  console.log(`✅  Saved ${outPath} (${(mp4.length / 1e6).toFixed(1)} MB, ${secs}s) — watch it before you queue it.`);
  process.exit(0);
}

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
