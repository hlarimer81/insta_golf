/**
 * Gemini Omni Flash text-to-video, over the Gemini Interactions API.
 *
 * Roughly a quarter of Seedance's price at 720p (~$0.07/s against ~$0.30/s),
 * with native audio, 3-15s clips and 9:16. Docs: aistudio.google.com/docs/omni.
 *
 * Two ways to run a request, tried in this order:
 *   1. background: the API hands back an interaction id at once, which we
 *      record (onSubmit) and poll. An interrupted run resumes from the id
 *      rather than paying for a second clip, like the fal.ai path does.
 *   2. synchronous: one long POST that returns the finished video. Used when
 *      the API refuses background mode for this model, which its docs don't
 *      promise. Done over node:https because fetch gives up waiting for
 *      response headers after 5 minutes, and a clip can take longer.
 */
import { request as httpsRequest } from "node:https";

const API = "https://generativelanguage.googleapis.com/v1beta";

/** POST/GET JSON with no client-side timeout. */
function call(method, url, key, body) {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      url,
      { method, headers: { "x-goog-api-key": key, "Content-Type": "application/json" } },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json;
          try {
            json = JSON.parse(text);
          } catch {
            json = { raw: text.slice(0, 800) };
          }
          resolve({ ok: res.statusCode < 300, status: res.statusCode, json });
        });
      },
    );
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/**
 * The first video in an interaction: steps[].content[] (REST), or
 * output_video (the SDK's convenience field, in case REST carries it too).
 * Skips `input`, which can echo request parts back.
 */
function findVideo(node) {
  if (Array.isArray(node)) {
    for (const n of node) {
      const v = findVideo(n);
      if (v) return v;
    }
    return null;
  }
  if (!node || typeof node !== "object") return null;
  if (node.type === "video" && (node.data || node.uri)) return node;
  if (node.output_video && (node.output_video.data || node.output_video.uri)) return node.output_video;
  for (const [k, v] of Object.entries(node)) {
    if (k === "input") continue;
    const found = findVideo(v);
    if (found) return found;
  }
  return null;
}

/** Why a finished interaction has no video: an error, or the model's text (often a refusal). */
function explain(json) {
  if (json.error) return json.error.message ?? JSON.stringify(json.error);
  // A failed interaction carries errors[] ({code, message}), e.g. RESOURCE_EXHAUSTED
  // when the key's project has no billing or quota for the model.
  if (json.errors?.length) return json.errors.map((e) => `${e.code}: ${e.message}`).join("; ");
  const texts = [];
  (function walk(n) {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== "object") return;
    if (n.type === "user_input") return; // our own prompt, echoed back
    if (n.type === "text" && typeof n.text === "string") texts.push(n.text);
    for (const [k, v] of Object.entries(n)) if (k !== "input") walk(v);
  })(json.steps ?? json);
  return texts.join(" ").slice(0, 800) || JSON.stringify(json).slice(0, 800);
}

async function download(video, key) {
  if (video.data) return Buffer.from(video.data, "base64");
  // A uri points into the Files API: wait until the file is ACTIVE, then fetch it.
  const fileId = video.uri.split("/files/")[1]?.split(/[:?]/)[0];
  if (fileId) {
    for (let i = 0; i < 60; i++) {
      const f = await call("GET", `${API}/files/${fileId}`, key);
      if (f.json.state === "ACTIVE" || !f.json.state) break;
      if (f.json.state === "FAILED") throw new Error(`video file ${fileId} failed processing`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  const res = await fetch(video.uri, { headers: { "x-goog-api-key": key } });
  if (!res.ok) throw new Error(`video download failed: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Generate one clip. Returns the MP4 as a Buffer.
 *
 *   resume    an interaction id from an earlier, interrupted run
 *   onSubmit  called with the interaction id as soon as there is one
 */
export async function generateOmni({ key, model, prompt, seconds, resolution, resume, onSubmit, log = console.log }) {
  const body = {
    model,
    input: prompt,
    response_format: {
      type: "video",
      aspect_ratio: "9:16",
      resolution,
      duration: `${Math.min(15, Math.max(3, Math.round(seconds)))}s`,
    },
  };

  let id = resume ?? null;
  let done = null;

  if (!id) {
    const res = await call("POST", `${API}/interactions`, key, { ...body, background: true, store: true });
    if (res.ok && res.json.status === "completed") {
      done = res.json;
    } else if (res.ok && res.json.id) {
      id = res.json.id;
      onSubmit?.(id);
    } else if (res.status === 400) {
      // Most likely background mode isn't offered for this model.
      log(`   background mode refused (${explain(res.json).slice(0, 160)}); generating synchronously…`);
      const sync = await call("POST", `${API}/interactions`, key, {
        ...body,
        response_format: { ...body.response_format, delivery: "uri" },
      });
      if (!sync.ok) throw new Error(`Gemini ${model} HTTP ${sync.status}: ${explain(sync.json)}`);
      done = sync.json;
    } else {
      throw new Error(`Gemini ${model} HTTP ${res.status}: ${explain(res.json)}`);
    }
  }

  if (!done) {
    log(`   polling interaction ${id}…`);
    const deadline = Date.now() + 20 * 60 * 1000;
    for (;;) {
      const res = await call("GET", `${API}/interactions/${id}`, key);
      if (!res.ok) throw new Error(`Gemini status check HTTP ${res.status}: ${explain(res.json)}`);
      if (res.json.status !== "in_progress") {
        done = res.json;
        break;
      }
      if (Date.now() > deadline) {
        const err = new Error("still generating after 20 minutes; re-run later to pick it back up");
        err.resumable = true;
        throw err;
      }
      await new Promise((r) => setTimeout(r, 10_000));
    }
  }

  if (done.status && done.status !== "completed") {
    throw new Error(`interaction ${done.status}: ${explain(done)}`);
  }
  const video = findVideo(done.steps ?? done);
  if (!video) throw new Error(`no video returned (it may have been refused): ${explain(done)}`);
  return download(video, key);
}
