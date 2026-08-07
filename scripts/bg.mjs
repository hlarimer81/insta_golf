#!/usr/bin/env node
/**
 * Generate an AI background image for a Reel with fal.ai (Flux) and wire it in.
 *
 *   npm run bg -- <slug>
 *   npm run bg -- <slug> --prompt "moody links course at dawn, fog on the fairway"
 *
 * Saves the image to public/broll/<slug>.png, sets brollSrc on the script, then
 * `npm run render -- scripts/<slug>.json` bakes it behind the text (Ken-Burns).
 *
 * Requires FAL_KEY in .env (get one at fal.ai). Cost is ~1–4¢/image.
 */
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
if (!slug) {
  console.error("Usage: npm run bg -- <slug> [--prompt \"...\"]");
  process.exit(1);
}

const scriptPath = join(scriptsDir, `${slug}.json`);
if (!existsSync(scriptPath)) {
  console.error(`No script scripts/${slug}.json`);
  process.exit(1);
}
const reel = JSON.parse(readFileSync(scriptPath, "utf8"));

// On-brand default: an atmospheric golf scene that reads well *under* the dark
// green scrim and cream text. No people/text so the overlay stays clean.
const prompt =
  promptOverride ??
  `Cinematic atmospheric golf course photograph, deep fairway greens, soft morning light and mist, shallow depth of field, moody and minimal, lots of negative space, no people, no text, no logos. Themed loosely around: ${reel.hook}`;

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
    image_size: "portrait_16_9", // 9:16 portrait, matches the Reel canvas
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
