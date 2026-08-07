#!/usr/bin/env node
/**
 * Render a script's carousel slides to PNGs (one still per slide).
 *
 *   npm run render:carousel -- your-chips-are-fat-because-you-scoop
 *   npm run render:carousel -- scripts/three-putts-arent-a-putting-problem.json
 *
 * Output: out/carousels/<slug>/01.png, 02.png, … in swipe order
 * (cover → one per beat → CTA). Feed straight to carousel publishing.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, basename } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scriptsDir = join(root, "scripts");

const arg = process.argv[2];
if (!arg) {
  console.error("Usage: npm run render:carousel -- <slug or path to script.json>");
  process.exit(1);
}
// Accept a bare slug or a path.
const scriptPath = arg.endsWith(".json") ? resolve(arg) : join(scriptsDir, `${arg}.json`);
const slug = basename(scriptPath, ".json");

let script;
try {
  script = JSON.parse(readFileSync(scriptPath, "utf8"));
} catch {
  console.error(`Couldn't read ${scriptPath}`);
  process.exit(1);
}

const slideCount = (script.beats?.length ?? 0) + 2; // cover + beats + CTA
const outDir = join(root, "out", "carousels", slug);
mkdirSync(outDir, { recursive: true });

console.log(`\n🖼   Rendering ${slideCount} carousel slides for "${slug}"`);
for (let i = 0; i < slideCount; i++) {
  const n = String(i + 1).padStart(2, "0");
  const outFile = join(outDir, `${n}.png`);
  const res = spawnSync(
    "npx",
    [
      "remotion",
      "still",
      "Carousel",
      outFile,
      `--frame=${i}`,
      `--props=${scriptPath}`,
    ],
    { stdio: "inherit", cwd: root },
  );
  if (res.status !== 0) {
    console.error(`❌  Failed on slide ${n}`);
    process.exit(res.status ?? 1);
  }
  console.log(`   → out/carousels/${slug}/${n}.png`);
}

console.log(`\n✅  Done. ${slideCount} slides in out/carousels/${slug}/`);
