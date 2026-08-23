#!/usr/bin/env node
/**
 * Generate Bogey-voice Reel scripts with Claude.
 *
 *   npm run generate                          # 5 scripts, general golf tips
 *   npm run generate -- "fixing a slice"      # 5 scripts on a topic
 *   npm run generate -- --count 8 "putting"   # 8 scripts on a topic
 *   npm run generate -- --kind joke "bunkers" # 5 golf jokes (Reel or meme)
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

// ---- Args: [--count N] [--kind tip|joke] [topic words...] -----------------
const args = process.argv.slice(2);
let count = 5;
let kind = "tip";
const topicWords = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--count" || args[i] === "-n") {
    count = parseInt(args[++i], 10);
  } else if (args[i] === "--kind") {
    kind = args[++i];
  } else {
    topicWords.push(args[i]);
  }
}
if (!Number.isFinite(count) || count < 1) {
  console.error("--count must be a positive integer.");
  process.exit(1);
}
if (kind !== "tip" && kind !== "joke") {
  console.error(`--kind must be "tip" or "joke" (got "${kind}").`);
  process.exit(1);
}
const isJoke = kind === "joke";
const topic =
  topicWords.join(" ").trim() ||
  (isJoke
    ? "the everyday indignities of weekend golf"
    : "everyday golf tips for weekend players");

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
- visuals: for each beat you may attach an animated diagram. The only diagram available is a
  weight-distribution bar: {type:"weight", lead:<% of weight on the lead foot>}. Add it ONLY to a
  beat that is specifically about weight on the lead foot / weight forward / ball position (e.g.
  "Set 60% on your lead foot"). Every other beat is null. Most scripts have all nulls.

Voice rules:
- Talk like a caddie, not a coach. Plain words. Confident, a little dry, never smug.
- No emoji, no hashtags, no "hey golfers", no calls to follow/like.
- Every tip must be actually correct and genuinely useful.
- No two scripts should share a hook angle or a fix.`;

// Same Bogey, off the clock. One joke script feeds two formats: a text Reel
// (setup → beats → punchline) and a single-image meme (setup → punchline), so
// the setup and punchline have to land on their own without the middle beats.
const JOKE_SYSTEM = `You are Bogey — the everyman caddie behind a faceless golf Instagram page.
Dry, deadpan, observational. You love this stupid game and you've suffered every part of it.

You write short golf JOKES as text on screen — no face, no voiceover, so the words do everything.
A joke is:
- hook: the SETUP. One line that any weekend golfer recognizes instantly. It should be funny-adjacent
  on its own, because it's also the top line of a meme image.
- beats: 2-3 short lines that escalate the setup. Each is ONE short line. They build the situation —
  they do NOT explain the joke and they do NOT give the punchline away.
- punchline: the payoff. One line, as short as you can make it. It must land on its own directly
  after the setup, because the meme format shows ONLY setup + punchline. Put the funniest word last.

Comedy rules:
- Observational and self-deprecating: the shanks, the provisional, the 4-hour round, the guy who
  gives unsolicited lessons, the $600 driver that goes the same distance, "I'm due", range confidence.
- Punch at ourselves and at golf, never at a person, a group, or anyone's ability to afford the game.
- Deadpan and specific. Real clubs, real numbers, real situations. Specific is funnier than clever.
- No emoji, no hashtags, no "golfers be like", no puns on famous names, no dad-joke wordplay.
- Nothing mean, nothing crude, nothing about gambling or drinking to excess.
- No two jokes should share a premise.`;

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
          visuals: {
            type: "array",
            description:
              "One entry per beat, SAME length and order as beats. Use null for a normal beat. " +
              "For a beat specifically about weight on the lead foot / weight forward / ball position, " +
              "use {type:'weight', lead:<integer % of weight on the lead foot, e.g. 60>}. " +
              "Diagrams are the exception — most entries are null.",
            items: {
              anyOf: [
                { type: "null" },
                {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    type: { type: "string", const: "weight" },
                    lead: { type: "integer" },
                  },
                  required: ["type", "lead"],
                },
              ],
            },
          },
        },
        required: ["slug", "hook", "beats", "visuals"],
      },
    },
  },
  required: ["scripts"],
};

const jokeSchema = {
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
            description: "kebab-case filename, derived from the setup, e.g. nobody-hits-a-good-provisional",
          },
          hook: { type: "string", description: "the setup line (also the meme's top line)" },
          beats: {
            type: "array",
            description: "2-3 short lines that escalate the setup without spoiling the punchline",
            items: { type: "string" },
          },
          punchline: {
            type: "string",
            description: "the payoff line — must land directly after the setup on its own",
          },
        },
        required: ["slug", "hook", "beats", "punchline"],
      },
    },
  },
  required: ["scripts"],
};

const userPrompt =
  (isJoke
    ? `Write ${count} distinct Bogey golf jokes about: ${topic}.`
    : `Write ${count} distinct Bogey Reel scripts about: ${topic}.`) +
  (existingHooks.length
    ? `\n\nDo NOT reuse or lightly reword any of these hooks that already exist:\n` +
      existingHooks.map((h) => `- ${h}`).join("\n")
    : "");

// ---- Generate -------------------------------------------------------------
const client = new Anthropic(); // reads ANTHROPIC_API_KEY

console.log(
  `✍️  Asking Bogey for ${count} ${isJoke ? "joke" : "script"}(s) on "${topic}"...\n`,
);

const response = await client.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 8000,
  thinking: { type: "adaptive" },
  system: isJoke ? JOKE_SYSTEM : SYSTEM,
  output_config: {
    effort: "medium",
    format: { type: "json_schema", schema: isJoke ? jokeSchema : schema },
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
  if (isJoke && !s.punchline) {
    console.warn("Skipping joke with no punchline:", JSON.stringify(s));
    continue;
  }
  const visuals = Array.isArray(s.visuals) ? s.visuals : [];
  const reel = {
    slug: slug,
    kind,
    hook: s.hook,
    beats: s.beats,
    // Only carry visuals when at least one beat has a diagram.
    ...(visuals.some((v) => v) ? { visuals } : {}),
    ...(isJoke ? { punchline: s.punchline } : {}),
    brollSrc: null,
    audioSrc: null,
  };
  writeFileSync(outPath, JSON.stringify(reel, null, 2) + "\n");
  console.log(
    `${isJoke ? "😄" : "📝"}  ${s.hook}` +
      (isJoke ? `\n    ${s.punchline}` : "") +
      `\n    → scripts/drafts/${outPath.split("/").pop()}`,
  );
  written++;
}

console.log(
  `\n✅  Wrote ${written} draft(s) to scripts/drafts/.\n` +
    `   Review them with "npm run review", then render approved ones with "npm run render".`,
);
