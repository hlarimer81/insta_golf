#!/usr/bin/env node
/**
 * Review generated draft Reels before they can be rendered.
 *
 *   npm run review
 *
 * Walks every script in scripts/drafts/ and, for each one, lets you:
 *   [a] approve → moves it to scripts/  (becomes render-eligible)
 *   [r] reject  → moves it to scripts/rejected/  (kept for reference)
 *   [s] skip    → leaves it in drafts/ for next time
 *   [q] quit    → stop reviewing; undecided drafts stay put
 *
 * The renderer only ever reads top-level scripts/*.json, so nothing gets
 * rendered until it's approved here.
 */
import { readFileSync, readdirSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, basename } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scriptsDir = join(root, "scripts");
const draftsDir = join(scriptsDir, "drafts");
const rejectedDir = join(scriptsDir, "rejected");

const drafts = existsSync(draftsDir)
  ? readdirSync(draftsDir)
      .filter((f) => f.endsWith(".json"))
      .sort()
  : [];

if (drafts.length === 0) {
  console.log("No drafts to review. Generate some with \"npm run generate\".");
  process.exit(0);
}

// Move a file into `destDir`, bumping the name (slug-2, slug-3, …) on collision.
const moveInto = (fromPath, destDir) => {
  mkdirSync(destDir, { recursive: true });
  const name = basename(fromPath, ".json");
  let candidate = name;
  let n = 2;
  while (existsSync(join(destDir, `${candidate}.json`))) candidate = `${name}-${n++}`;
  const destPath = join(destDir, `${candidate}.json`);
  renameSync(fromPath, destPath);
  return destPath;
};

// Pull input one line at a time. The async iterator buffers piped input
// correctly (no dropped lines) and signals EOF via `done`, which the promise
// `question()` API mishandles.
const rl = createInterface({ input });
const lines = rl[Symbol.asyncIterator]();
const ask = async (promptText) => {
  output.write(promptText);
  const { value, done } = await lines.next();
  return done ? null : value.trim().toLowerCase();
};

let approved = 0;
let rejected = 0;
let skipped = 0;

console.log(`\nReviewing ${drafts.length} draft(s) in scripts/drafts/\n`);

for (let i = 0; i < drafts.length; i++) {
  const file = drafts[i];
  const path = join(draftsDir, file);
  let reel;
  try {
    reel = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    console.log(`⚠️  ${file} isn't valid JSON — skipping.\n`);
    skipped++;
    continue;
  }

  // Show the whole Reel the way it'll read on screen.
  console.log("─".repeat(60));
  console.log(`Draft ${i + 1}/${drafts.length}  (${file})\n`);
  console.log(`  HOOK   ${reel.hook}`);
  for (const beat of reel.beats ?? []) console.log(`  BEAT   ${beat}`);
  console.log("");

  let decided = false;
  while (!decided) {
    const answer = await ask("  [a]pprove  [r]eject  [s]kip  [q]uit ? ");
    // null = stdin closed (EOF or Ctrl-D): stop, leave undecided drafts put.
    if (answer === null || answer === "q" || answer === "quit") {
      console.log("\nStopping. Undecided drafts left in scripts/drafts/.");
      rl.close();
      summarize();
      process.exit(0);
    }
    switch (answer) {
      case "a":
      case "approve": {
        const dest = moveInto(path, scriptsDir);
        console.log(`  ✅ approved → scripts/${basename(dest)}\n`);
        approved++;
        decided = true;
        break;
      }
      case "r":
      case "reject": {
        const dest = moveInto(path, rejectedDir);
        console.log(`  🗑  rejected → scripts/rejected/${basename(dest)}\n`);
        rejected++;
        decided = true;
        break;
      }
      case "s":
      case "skip":
        console.log("  ↷ skipped (left in drafts/)\n");
        skipped++;
        decided = true;
        break;
      default:
        console.log("  Please answer a, r, s, or q.");
    }
  }
}

rl.close();
summarize();

function summarize() {
  console.log("─".repeat(60));
  console.log(`Done: ${approved} approved, ${rejected} rejected, ${skipped} skipped.`);
  if (approved > 0) console.log(`Render the approved batch with "npm run render".`);
}
