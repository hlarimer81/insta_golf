#!/usr/bin/env node
/**
 * Generate Bogey-voice Reel scripts with Claude.
 *
 *   npm run generate                          # 5 scripts, general golf tips
 *   npm run generate -- "fixing a slice"      # 5 scripts on a topic
 *   npm run generate -- --count 8 "putting"   # 8 scripts on a topic
 *
 * Each generated script is written to scripts/<slug>.json in the same shape
 * the renderer consumes (see src/schema.ts). Feed them straight to:
 *
 *   npm run render
 *
 * Requires ANTHROPIC_API_KEY in the environment.
 */
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scriptsDir = join(root, "scripts");
// Fresh scripts land here as drafts and wait for `npm run review` before they
// become render-eligible (see scripts/review.mjs).
const draftsDir = join(scriptsDir, "drafts");
const rejectedDir = join(scriptsDir, "rejected");

// Load ANTHROPIC_API_KEY from a git-ignored .env if it isn't already set.
// (process.loadEnvFile is built in on Node 20.6+ and throws if .env is absent.)
if (!process.env.ANTHROPIC_API_KEY) {
  try {
    process.loadEnvFile(join(root, ".env"));
  } catch {
    // no .env file — fall through to the check below
  }
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error(
    "ANTHROPIC_API_KEY is not set.\n" +
      "Add it to a .env file in the project root (it's git-ignored):\n" +
      '  echo "ANTHROPIC_API_KEY=sk-ant-..." > .env\n' +
      "or export it in your shell before running.",
  );
  process.exit(1);
}

// ---- Args: [--count N] [topic words...] ----------------------------------
const args = process.argv.slice(2);
let count = 5;
const topicWords = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--count" || args[i] === "-n") {
    count = parseInt(args[++i], 10);
  } else {
    topicWords.push(args[i]);
  }
}
if (!Number.isFinite(count) || count < 1) {
  console.error("--count must be a positive integer.");
  process.exit(1);
}
const topic = topicWords.join(" ").trim() || "everyday golf tips for weekend players";

// ---- What's already been written (so Bogey doesn't repeat himself) --------
// Scan approved, drafted, and rejected scripts alike.
const hooksIn = (dir) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => {
          try {
            return JSON.parse(readFileSync(join(dir, f), "utf8")).hook;
          } catch {
            return null;
          }
        })
        .filter(Boolean)
    : [];
const existingHooks = [
  ...hooksIn(scriptsDir),
  ...hooksIn(draftsDir),
  ...hooksIn(rejectedDir),
];

// Bogey's brand voice lives in src/brand.ts; his character lives here.
const SYSTEM = `You are Bogey — the everyman caddie behind a faceless golf Instagram page.
Dry, honest, encouraging. You've seen every weekend hack's mistake and you fix it in 15 seconds.

You write scripts for TEXT-ON-SCREEN vertical Reels — no face, no voiceover, so every word
carries the whole video. A script is:
- hook: the 0-1 second opening line. This is 90% of whether the Reel works. Make it stop a thumb:
  a myth to bust, a bold claim, a "stop doing X", a number. Short. Punchy. No hashtags, no emoji.
- beats: 3-5 sequential on-screen lines that pay off the hook. Each beat is ONE short line
  (a phone screen's width), timed to a b-roll cut. Build: problem -> the real cause -> the fix ->
  the payoff. Concrete and specific — real numbers, real body parts, real feel. No filler.

Voice rules:
- Talk like a caddie, not a coach. Plain words. Confident, a little dry, never smug.
- No emoji, no hashtags, no "hey golfers", no calls to follow/like.
- Every tip must be actually correct and genuinely useful.
- No two scripts should share a hook angle or a fix.`;

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    scripts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          slug: {
            type: "string",
            description: "kebab-case filename, derived from the hook, e.g. stop-buying-a-new-driver",
          },
          hook: { type: "string", description: "the 0-1s opening line" },
          beats: {
            type: "array",
            description: "3-5 short on-screen lines that pay off the hook",
            items: { type: "string" },
          },
        },
        required: ["slug", "hook", "beats"],
      },
    },
  },
  required: ["scripts"],
};

const userPrompt =
  `Write ${count} distinct Bogey Reel scripts about: ${topic}.` +
  (existingHooks.length
    ? `\n\nDo NOT reuse or lightly reword any of these hooks that already exist:\n` +
      existingHooks.map((h) => `- ${h}`).join("\n")
    : "");

// ---- Generate -------------------------------------------------------------
const client = new Anthropic(); // reads ANTHROPIC_API_KEY

console.log(`✍️  Asking Bogey for ${count} script(s) on "${topic}"...\n`);

const response = await client.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 8000,
  thinking: { type: "adaptive" },
  system: SYSTEM,
  output_config: {
    effort: "medium",
    format: { type: "json_schema", schema },
  },
  messages: [{ role: "user", content: userPrompt }],
});

const textBlock = response.content.find((b) => b.type === "text");
if (!textBlock) {
  console.error("No text output from the model. Stop reason:", response.stop_reason);
  process.exit(1);
}
const { scripts } = JSON.parse(textBlock.text);

// ---- Write ----------------------------------------------------------------
const slugify = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "bogey-reel";

// A slug is "taken" if any approved / draft / rejected script already uses it,
// so drafts never collide with each other or with already-decided scripts.
const slugTaken = (slug) =>
  [scriptsDir, draftsDir, rejectedDir].some((d) =>
    existsSync(join(d, `${slug}.json`)),
  );
const uniqueDraftPath = (slug) => {
  let candidate = slug;
  let n = 2;
  while (slugTaken(candidate)) candidate = `${slug}-${n++}`;
  return join(draftsDir, `${candidate}.json`);
};

mkdirSync(draftsDir, { recursive: true });

let written = 0;
for (const s of scripts) {
  if (!s.hook || !Array.isArray(s.beats) || s.beats.length === 0) {
    console.warn("Skipping malformed script:", JSON.stringify(s));
    continue;
  }
  const slug = slugify(s.slug || s.hook);
  const outPath = uniqueDraftPath(slug);
  const reel = {
    slug: slug,
    hook: s.hook,
    beats: s.beats,
    brollSrc: null,
    audioSrc: null,
  };
  writeFileSync(outPath, JSON.stringify(reel, null, 2) + "\n");
  console.log(`📝  ${s.hook}\n    → scripts/drafts/${outPath.split("/").pop()}`);
  written++;
}

console.log(
  `\n✅  Wrote ${written} draft(s) to scripts/drafts/.\n` +
    `   Review them with "npm run review", then render approved ones with "npm run render".`,
);
