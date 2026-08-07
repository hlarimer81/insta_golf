#!/usr/bin/env node
/**
 * Render one or many Bogey Reels from script JSON files.
 *
 *   npm run render                      # renders every scripts/*.json
 *   npm run render scripts/foo.json     # renders one script
 *
 * Each script's `slug` becomes the output filename in out/.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scriptsDir = join(root, "scripts");

const args = process.argv.slice(2);
const files = args.length
  ? args
  : readdirSync(scriptsDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => join(scriptsDir, f));

if (files.length === 0) {
  console.error("No script JSON files found. Add one to scripts/ or pass a path.");
  process.exit(1);
}

for (const file of files) {
  const path = resolve(file);
  const script = JSON.parse(readFileSync(path, "utf8"));
  const slug = script.slug ?? "bogey-reel";
  const outFile = join(root, "out", `${slug}.mp4`);

  console.log(`\n🎬  Rendering "${slug}"  →  out/${slug}.mp4`);
  const res = spawnSync(
    "npx",
    ["remotion", "render", "BogeyReel", outFile, `--props=${path}`],
    { stdio: "inherit", cwd: root }
  );
  if (res.status !== 0) {
    console.error(`❌  Render failed for ${slug}`);
    process.exit(res.status ?? 1);
  }
}

console.log("\n✅  Done.");
