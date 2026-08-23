#!/usr/bin/env node
/**
 * Render a joke script as a meme — either a single image or a short Reel.
 *
 *   npm run render:meme -- nobody-hits-a-good-provisional
 *   npm run render:meme -- nobody-hits-a-good-provisional --reel
 *
 * Output:
 *   image  out/memes/<slug>.png    → npm run enqueue -- <slug> --at <ISO> --meme
 *   --reel out/<slug>.mp4          → npm run enqueue -- <slug> --at <ISO>
 *
 * The Reel cut is the same joke (setup holds, punchline drops in) as vertical
 * video, which reaches far more people than a static feed post does.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, basename } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scriptsDir = join(root, "scripts");

const args = process.argv.slice(2);
const asReel = args.includes("--reel");
const arg = args.find((a) => !a.startsWith("--"));
if (!arg) {
  console.error("Usage: npm run render:meme -- <slug or path to script.json> [--reel]");
  process.exit(1);
}
const scriptPath = arg.endsWith(".json") ? resolve(arg) : join(scriptsDir, `${arg}.json`);
const slug = basename(scriptPath, ".json");

let script;
try {
  script = JSON.parse(readFileSync(scriptPath, "utf8"));
} catch {
  console.error(`Couldn't read ${scriptPath}`);
  process.exit(1);
}
if (!script.punchline) {
  console.error(
    `scripts/${slug}.json has no punchline — memes are built from joke scripts.\n` +
      `Generate one with: npm run generate -- --kind joke "<topic>"`,
  );
  process.exit(1);
}

const outDir = asReel ? join(root, "out") : join(root, "out", "memes");
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, `${slug}.${asReel ? "mp4" : "png"}`);

console.log(`\n😄  Rendering meme ${asReel ? "Reel" : "image"} for "${slug}"`);
const res = spawnSync(
  "npx",
  asReel
    ? ["remotion", "render", "MemeReel", outFile, `--props=${scriptPath}`]
    : ["remotion", "still", "Meme", outFile, `--props=${scriptPath}`],
  { stdio: "inherit", cwd: root },
);
if (res.status !== 0) {
  console.error("❌  Meme render failed.");
  process.exit(res.status ?? 1);
}

console.log(`\n✅  ${asReel ? `out/${slug}.mp4` : `out/memes/${slug}.png`}`);
