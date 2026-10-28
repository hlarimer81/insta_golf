#!/usr/bin/env node
/**
 * Write "golf babies" sketches with Claude: two babies on a golf course,
 * talking golf or doing something dumb on the course, as short AI video Reels.
 *
 *   npm run babies                                  # 3 sketches, mixed styles
 *   npm run babies -- --style talk "range etiquette"  # babies chatting golf
 *   npm run babies -- --style slapstick --count 5   # physical comedy
 *   npm run babies -- --pool 20                     # write 20, keep the best 3
 *
 * Claude writes a pool of sketches (12 by default, never fewer than 3x the
 * count), a second call judges them as a tough golf-comedy editor, and only
 * the top --count become drafts. Writing is cheap and the video is not, so
 * the culling happens here rather than after paying for renders.
 *
 * Drafts land in scripts/drafts/ like every other script, so `npm run review`
 * gates them. After approving one, turn it into a video:
 *
 *   npm run render:babies -- <slug>
 *
 * The babies are a recurring pair whose looks live in scripts/lib/babies.mjs.
 *
 * Requires ANTHROPIC_API_KEY in .env.
 */
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { normalizeTags } from "./lib/instagram.mjs";
import { CAST } from "./lib/babies.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scriptsDir = join(root, "scripts");
const draftsDir = join(scriptsDir, "drafts");
const rejectedDir = join(scriptsDir, "rejected");

if (!process.env.ANTHROPIC_API_KEY) {
  try {
    process.loadEnvFile(join(root, ".env"));
  } catch {
    // no .env file — fall through to the check below
  }
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set. Add it to .env (see .env.example).");
  process.exit(1);
}

// ---- Args: [--count N] [--pool N] [--style talk|slapstick|mix] [topic...] ----
const args = process.argv.slice(2);
let count = 3;
let pool;
let style = "mix";
const topicWords = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--count" || args[i] === "-n") count = parseInt(args[++i], 10);
  else if (args[i] === "--pool") pool = parseInt(args[++i], 10);
  else if (args[i] === "--style") style = args[++i];
  else topicWords.push(args[i]);
}
if (!Number.isFinite(count) || count < 1) {
  console.error("--count must be a positive integer.");
  process.exit(1);
}
pool ??= Math.max(12, count * 3);
if (!Number.isFinite(pool) || pool < count) {
  console.error("--pool must be a number at least as large as --count.");
  process.exit(1);
}
if (!["talk", "slapstick", "mix"].includes(style)) {
  console.error(`--style must be talk, slapstick or mix (got "${style}").`);
  process.exit(1);
}
const topic = topicWords.join(" ").trim() || "the everyday indignities of weekend golf";

// Hooks across every script, so the babies don't redo a premise Bogey or they
// have already used.
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
const existingHooks = [...hooksIn(scriptsDir), ...hooksIn(draftsDir), ...hooksIn(rejectedDir)];

const STYLE_RULE = {
  talk:
    "Every sketch is a TALK sketch: the two babies sit or stand on the course where the shot " +
    "they're talking about happens (see the setting rules) and talk golf like two weekend " +
    "hackers. The joke is in the dialogue.",
  slapstick:
    "Every sketch is a SLAPSTICK sketch: one baby attempts a golf shot or move and it goes " +
    "comically wrong, the other baby reacts. The joke is in what happens; dialogue is one or two " +
    "short lines at most.",
  mix: "Alternate TALK sketches (the joke is in the dialogue) and SLAPSTICK sketches (one baby " +
    "attempts something on the course, it goes comically wrong, the other reacts).",
}[style];

const SYSTEM = `You write short comedy sketches for a golf Instagram page, starring two babies:
- Birdie: ${CAST.Birdie}
- Mulligan: ${CAST.Mulligan}

Each sketch becomes ONE AI-generated vertical video clip of 6-12 seconds, with the babies' speech
generated and lip-synced by the video model. So:
- Dialogue is short. 2-4 lines total, each under 12 words, ~25 words across the whole sketch.
  Babies talking like grizzled weekend golfers is the joke: "I'm due." "That's a gimme."
- The action must be simple and filmable in one continuous shot from one camera angle: one
  setting, one or two physical moments. No cuts, no scene changes, no text on screen.
- Land the laugh at the end: the last line or the reaction (a belly laugh, a deadpan stare).

${STYLE_RULE}

Setting rules — the background must match the shot the sketch is about, so a golfer instantly
recognizes where they are:
- A tee shot or the driver: on a tee box, with tee markers and the fairway stretching out behind.
- Putting: on a putting green, with the hole and its flagstick clearly visible in frame.
- Being in the rough or the trees: in long rough grass, or among the trees off the fairway.
- A bunker shot or a water hazard: in or beside the bunker, or at the pond's edge.
- Any other shot (approach, layup, chip from short grass): on the fairway.
Name the setting explicitly in the "setting" field, including what's visible behind the babies.

Where the laugh comes from — every sketch uses at least one of these. Adult golf small talk in a
baby's mouth is NOT enough on its own; the joke must collide golf-guy attitude with being a baby.
1. Undercut the golf brag with babyhood. A grizzled golfer line, then reality: they're ten
   months old, can't lift the club, can't count, nap twice a day, drink from bottles, crawl.
     Mulligan: "Been playing my whole life." Birdie: "You're ten months old." Mulligan: "Long life."
     Mulligan: "I'm due." Birdie: "You're due for a nap."
     Mulligan: "I'm hitting driver." Birdie: "You can't lift driver." Mulligan, dragging it:
     "I'm dragging driver."
2. Brag, physical fail, one-word tag. A confident line right BEFORE the fall, whiff or hat
   slipping over the eyes, then a tiny deadpan tag AFTER it. Keep the falls and the hat — the
   tag line is what turns them into a punchline.
     "Watch and learn." (plop) Birdie: "Learned."
     Mulligan sits up dripping at the pond's edge: "...Provisional."
     Whiff, hat drops over his eyes: "Where'd it go?" Birdie: "Still on the tee."
3. Golfer excuses and rules taken literally.
     Birdie: "What'd you get?" Mulligan holds up his fingers: "...All of them."
     Mulligan picks up a ball twenty feet from the hole: "That's a gimme."
     "Sun was in my eyes." "Your hat is in your eyes."
4. The guy everyone golfs with. Make one baby a type a viewer will tag a friend as: the
   unsolicited swing-tip guy, the guy who blames his clubs, the guy who almost broke 80, the
   guy who takes six practice swings.
     Mulligan, from a stroller: "Your problem's your grip." Birdie: "You hold your bottle with
     your feet."
These are examples of the shape, not lines to reuse — write new ones.

Punchline rules:
- The punchline is the LAST thing said, and it is short: ideally 1-3 words. Nothing after it
  but a reaction (a belly laugh, a deadpan stare, the hat slipping down).
- No line that merely describes the situation ("The group behind is staring at us"). Every
  line is either a setup that the next line flips, or the flip.
- Babyhood material: naps, bottles, teething, crawling, pacifiers, not being able to count,
  being carried, strollers, bedtime. No diaper or bathroom jokes.

Comedy rules:
- The golf side is what every weekend golfer recognizes: the shank, the provisional, "I'm due",
  the $600 driver, slow play, unsolicited swing tips, range confidence, the gimme.
- Punch at golf and at themselves, never at a person or group.
- The babies are ALWAYS safe and unhurt. A fall is a plop onto a soft fairway, into a soft
  bunker, or into ankle-deep water at a pond's edge, and the baby sits right up, fine, dripping,
  indignant or giggling. Never real danger, never deep water, never distress or crying, no
  injuries, no adults needed to rescue anyone.
- Nothing crude, no drinking, no gambling.
- No two sketches share a premise.`;

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    sketches: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          slug: { type: "string", description: "kebab-case filename, e.g. mulligan-finds-the-pond" },
          style: { type: "string", enum: ["talk", "slapstick"] },
          hook: {
            type: "string",
            description:
              "One-line caption opener a golfer relates to, e.g. 'Every 7-iron I hit near water.' " +
              "Not shown in the video; it leads the post caption.",
          },
          setting: {
            type: "string",
            description:
              "Where they are on the course (per the setting rules), what's visible behind " +
              "them, and the camera framing, one sentence",
          },
          action: {
            type: "string",
            description:
              "What happens, in order, as one or two sentences of plain visual description " +
              "including when each line is spoken and the final reaction",
          },
          dialogue: {
            type: "array",
            description: "2-4 lines in the order spoken",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                speaker: { type: "string", enum: ["Birdie", "Mulligan"] },
                line: { type: "string" },
              },
              required: ["speaker", "line"],
            },
          },
          sound: {
            type: "string",
            description: "Ambient sound and effects, e.g. 'birdsong, a club whoosh, a splash, a giggle'",
          },
          seconds: { type: "integer", description: "Clip length, 6-12" },
          hashtags: {
            type: "array",
            description:
              "3-4 lowercase hashtags specific to this sketch, no # prefix, e.g. golfbaby, " +
              "waterhazard, firsttee. Do NOT include golf, golfmemes, golfhumor, golflife or " +
              "golfproblems — those are appended automatically.",
            items: { type: "string" },
          },
        },
        required: ["slug", "style", "hook", "setting", "action", "dialogue", "sound", "seconds", "hashtags"],
      },
    },
  },
  required: ["sketches"],
};

const userPrompt =
  `Write ${pool} distinct golf-baby sketches about: ${topic}. Vary the premise, the setting ` +
  `and which comedy technique each one leans on.` +
  (existingHooks.length
    ? `\n\nDo NOT reuse or lightly reword any of these existing premises:\n` +
      existingHooks.map((h) => `- ${h}`).join("\n")
    : "");

// ---- Generate -------------------------------------------------------------
const client = new Anthropic();
console.log(`👶👶  Writing ${pool} ${style} sketch(es) on "${topic}" to keep the best ${count}...\n`);

// Streamed: a 12-sketch pool needs an output budget the SDK refuses to wait
// on without streaming.
const response = await client.messages
  .stream({
    model: "claude-opus-4-8",
    max_tokens: 32000,
    thinking: { type: "adaptive" },
    system: SYSTEM,
    output_config: { effort: "medium", format: { type: "json_schema", schema } },
    messages: [{ role: "user", content: userPrompt }],
  })
  .finalMessage();

const textBlock = response.content.find((b) => b.type === "text");
if (!textBlock) {
  console.error("No text output from the model. Stop reason:", response.stop_reason);
  process.exit(1);
}
const { sketches: written_ } = JSON.parse(textBlock.text);

// ---- Judge ----------------------------------------------------------------
// The example punchlines from SYSTEM. The writer copies them despite being
// told not to, so the judge is told to sink any sketch that does.
const EXAMPLE_LINES = [
  "Long life. (after 'You're ten months old')",
  "You're due for a nap.",
  "I'm dragging driver.",
  "Learned. (after 'Watch and learn')",
  "...Provisional. (dripping at the pond)",
  "Still on the tee. (after a whiff)",
  "...All of them. (holding up fingers for a score)",
  "That's a gimme. (picking up a long putt)",
  "Your hat is in your eyes.",
  "You hold your bottle with your feet.",
];
// A separate call, so the judge isn't grading work it remembers writing. It
// scores what a viewer would do — laugh, tag a friend — not craft.
const JUDGE = `You are the toughest editor at a golf comedy Instagram page. You judge short sketches
for AI video clips starring two babies, Birdie and Mulligan, and you have seen every golf joke.

Score each sketch 1-10 on one question: would a weekend golfer scrolling Reels laugh out loud,
then tag or send it to a friend? Be harsh and use the whole scale:
- 1-3: a mild observation, adult golf small talk that doesn't use the babies being babies, a
  punchline that isn't the last line, or a line that just describes the situation.
- 4-6: a real joke but a familiar one, or a setup that telegraphs the punchline.
- 7-8: a genuine laugh with a short, surprising last line.
- 9-10: you would send it to your golf group yourself.
Judge the words and the action as they'd play in a 6-12 second clip; nothing else matters.

The writer was shown these lines as examples. A sketch that reuses one, or a close rewording of
one, as its punchline or premise scores 1-2 — it's a copy, not a joke:
${EXAMPLE_LINES.map((l) => `- ${l}`).join("\n")}`;

const judgeSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    ratings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          index: { type: "integer" },
          score: { type: "integer", description: "1-10" },
          reason: { type: "string", description: "One short sentence: why it does or doesn't land" },
        },
        required: ["index", "score", "reason"],
      },
    },
  },
  required: ["ratings"],
};

const listing = written_
  .map((s, i) =>
    [
      `[${i}] ${s.style?.toUpperCase()} — ${s.setting}`,
      `    Action: ${s.action}`,
      ...(s.dialogue ?? []).map((d) => `    ${d.speaker}: ${d.line}`),
    ].join("\n"),
  )
  .join("\n\n");

console.log(`⚖️   Judging ${written_.length} sketches...\n`);
const verdict = await client.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 8000,
  thinking: { type: "adaptive" },
  system: JUDGE,
  output_config: { effort: "medium", format: { type: "json_schema", schema: judgeSchema } },
  messages: [{ role: "user", content: `Score every one of these sketches:\n\n${listing}` }],
});
const verdictText = verdict.content.find((b) => b.type === "text");
if (!verdictText) {
  console.error("No text output from the judge. Stop reason:", verdict.stop_reason);
  process.exit(1);
}
const ratingOf = new Map(JSON.parse(verdictText.text).ratings.map((r) => [r.index, r]));
// An unrated sketch sorts last rather than sneaking through on a missing score.
const ranked = written_
  .map((s, i) => ({ s, r: ratingOf.get(i) ?? { score: 0, reason: "not rated" } }))
  .sort((a, b) => b.r.score - a.r.score);

// The judge favors talk sketches, whose joke is all on the page, so a mix
// keeps the best of each style before filling the rest on score. Otherwise
// the falls never make it to video.
const kept = new Set(
  style === "mix" && count >= 2
    ? ["talk", "slapstick"].map((st) => ranked.find((x) => x.s.style === st)).filter(Boolean)
    : [],
);
for (const x of ranked) if (kept.size < count) kept.add(x);

for (const { s, r } of ranked.filter((x) => !kept.has(x))) {
  console.log(`✂️   ${r.score}/10  ${s.dialogue?.at(-1)?.line ?? s.hook}  — ${r.reason}`);
}
console.log();
const sketches = ranked
  .filter((x) => kept.has(x))
  .map(({ s, r }) => ({ ...s, score: r.score, judge: r.reason }));

// ---- Write ----------------------------------------------------------------
const slugify = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "golf-babies";
const slugTaken = (slug) =>
  [scriptsDir, draftsDir, rejectedDir].some((d) => existsSync(join(d, `${slug}.json`)));
const uniqueDraftPath = (slug) => {
  let candidate = slug;
  let n = 2;
  while (slugTaken(candidate)) candidate = `${slug}-${n++}`;
  return join(draftsDir, `${candidate}.json`);
};

mkdirSync(draftsDir, { recursive: true });
let written = 0;
for (const s of sketches) {
  if (!s.hook || !s.action || !Array.isArray(s.dialogue) || !s.dialogue.length) {
    console.warn("Skipping malformed sketch:", JSON.stringify(s));
    continue;
  }
  const outPath = uniqueDraftPath(slugify(s.slug || s.hook));
  const slug = outPath.split("/").pop().replace(/\.json$/, "");
  const hashtags = normalizeTags(s.hashtags);
  const sketch = {
    slug,
    kind: "babies",
    style: s.style,
    hook: s.hook,
    // The spoken lines double as `beats`, so review, dedupe and anything else
    // that reads hook + beats works on these unchanged.
    beats: s.dialogue.map((d) => `${d.speaker}: ${d.line}`),
    setting: s.setting,
    action: s.action,
    dialogue: s.dialogue,
    sound: s.sound,
    seconds: Math.min(12, Math.max(6, s.seconds || 8)),
    ...(hashtags.length ? { hashtags } : {}),
    // The judge's read, kept so review can see why this one made the cut.
    score: s.score,
    judge: s.judge,
  };
  writeFileSync(outPath, JSON.stringify(sketch, null, 2) + "\n");
  console.log(
    `👶  ${s.score}/10  ${s.hook}\n    ${sketch.beats.join("\n    ")}\n    ` +
      `(${s.judge})\n    → scripts/drafts/${slug}.json`,
  );
  written++;
}

console.log(
  `\n✅  Wrote ${written} draft(s). Review with "npm run review", then\n` +
    `   make the video with "npm run render:babies -- <slug>".`,
);
