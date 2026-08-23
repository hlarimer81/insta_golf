#!/usr/bin/env node
/**
 * Generate an AI background image for a Reel with fal.ai (Flux) and wire it in.
 *
 *   npm run bg -- <slug>
 *   npm run bg -- <slug> --prompt "moody links course at dawn, fog on the fairway"
 *   npm run bg -- <slug> --ratio 4:5     # portrait crop for carousels / memes
 *
 * Saves the image to public/broll/<slug>.png, sets brollSrc on the script, then
 * `npm run render -- scripts/<slug>.json` bakes it behind the text (Ken-Burns).
 *
 * Requires FAL_KEY in .env (get one at fal.ai). Cost is ~1–4¢/image.
 */
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scriptsDir = join(root, "scripts");
const brollDir = join(root, "public", "broll");

if (existsSync(join(root, ".env"))) {
  try {
    process.loadEnvFile(join(root, ".env"));
  } catch {
    /* ignore */
  }
}
if (!process.env.FAL_KEY) {
  console.error("FAL_KEY is not set in .env. Get a key at https://fal.ai and add:\n  FAL_KEY=...");
  process.exit(1);
}

// ---- args -----------------------------------------------------------------
const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith("--"));
const pIdx = args.indexOf("--prompt");
const promptOverride = pIdx >= 0 ? args[pIdx + 1] : null;
const rIdx = args.indexOf("--ratio");
const ratio = rIdx >= 0 ? args[rIdx + 1] : "9:16";
if (!slug) {
  console.error("Usage: npm run bg -- <slug> [--prompt \"...\"] [--ratio 9:16|4:5]");
  process.exit(1);
}
// fal's closest supported sizes to the two canvases we render.
const imageSize = ratio === "4:5" ? "portrait_4_3" : "portrait_16_9";

const scriptPath = join(scriptsDir, `${slug}.json`);
if (!existsSync(scriptPath)) {
  console.error(`No script scripts/${slug}.json`);
  process.exit(1);
}
const reel = JSON.parse(readFileSync(scriptPath, "utf8"));

const isJoke = reel.kind === "joke";

// On-brand fallback if prompt-authoring is unavailable.
const fallbackPrompt = isJoke
  ? `Wry photographic golf still life, deep greens and warm natural light, shallow depth of field, empty space top and bottom of frame, no people, no text, no logos. Themed loosely around: ${reel.hook}`
  : `Cinematic atmospheric golf course photograph, deep fairway greens, soft morning light and mist, shallow depth of field, moody and minimal, lots of negative space, no people, no text, no logos. Themed loosely around: ${reel.hook}`;

// Ask Claude to theme the background to this specific script, on-brand and
// overlay-friendly: a tip gets a clean cinematic course (a putting tip gets a
// green, a driving tip a tee box), a joke gets the situation it's about (the
// ball in the water, the empty range bucket) — photographic and text-free
// either way, so the words on top do the work.
const TIP_PROMPT_SYSTEM =
  "You write concise text-to-image prompts for Instagram Reel backgrounds for a golf tips brand called Bogey. Requirements: cinematic, atmospheric golf-course photography themed to the specific tip; deep fairway greens and warm natural light to sit under a dark-green brand scrim; strong negative space and shallow depth of field so overlaid text stays readable; absolutely no people, no text, no logos, no clubs mid-swing. Output ONLY the image prompt as one paragraph — no preamble, no quotes.";
const JOKE_PROMPT_SYSTEM =
  "You write concise text-to-image prompts for Instagram meme backgrounds for a golf humor brand called Bogey. Requirements: photographic, slightly wry still-life of the SITUATION the joke is about (a ball plugged in a bunker, a ball floating at the edge of a pond, a beaten-up range bucket, a cart path at dusk); deep greens and warm natural light to sit under a dark-green brand scrim; large empty areas at the top and bottom of the frame so overlaid text stays readable; absolutely no people, no text, no logos, no cartoons. Output ONLY the image prompt as one paragraph — no preamble, no quotes.";

async function authorImagePrompt() {
  try {
    const client = new Anthropic(); // ANTHROPIC_API_KEY from .env
    const res = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 400,
      system: isJoke ? JOKE_PROMPT_SYSTEM : TIP_PROMPT_SYSTEM,
      messages: [
        {
          role: "user",
          content: isJoke
            ? `Write a background image prompt for this golf joke.\n\nSetup: ${reel.hook}\nBeats: ${reel.beats.join(" / ")}\nPunchline: ${reel.punchline ?? ""}`
            : `Write a background image prompt themed to this golf tip.\n\nHook: ${reel.hook}\nBeats: ${reel.beats.join(" / ")}`,
        },
      ],
    });
    const text = res.content.find((b) => b.type === "text")?.text?.trim();
    return text || null;
  } catch (e) {
    console.warn(`  (prompt authoring failed: ${e.message} — using default)`);
    return null;
  }
}

const prompt = promptOverride ?? (await authorImagePrompt()) ?? fallbackPrompt;
console.log(`   prompt: ${prompt.slice(0, 120)}${prompt.length > 120 ? "…" : ""}`);

// ---- fal.ai Flux (schnell = fast + cheap) ---------------------------------
const model = process.env.FAL_MODEL ?? "fal-ai/flux/schnell";
console.log(`🎨  Generating background for "${slug}" via ${model}…`);

const res = await fetch(`https://fal.run/${model}`, {
  method: "POST",
  headers: {
    Authorization: `Key ${process.env.FAL_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    prompt,
    image_size: imageSize, // 9:16 for Reels, 4:5-ish for carousels + memes
    num_images: 1,
    enable_safety_checker: true,
  }),
});
const data = await res.json();
if (!res.ok || !data.images?.[0]?.url) {
  console.error("fal.ai request failed:", data.error ?? data.detail ?? res.statusText);
  process.exit(1);
}

// ---- download + wire into the script --------------------------------------
mkdirSync(brollDir, { recursive: true });
const imgRes = await fetch(data.images[0].url);
const buf = Buffer.from(await imgRes.arrayBuffer());
const outPath = join(brollDir, `${slug}.png`);
writeFileSync(outPath, buf);

reel.brollSrc = `broll/${slug}.png`; // resolved from public/ by the renderer
writeFileSync(scriptPath, JSON.stringify(reel, null, 2) + "\n");

console.log(`✅  Saved public/broll/${slug}.png and set brollSrc.`);
console.log(`   Now render it in:  npm run render -- scripts/${slug}.json`);
