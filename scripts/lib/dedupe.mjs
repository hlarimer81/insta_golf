/**
 * Catch scripts that repeat advice the account has already given.
 *
 * The generator dedupes on HOOKS, which only catches repeated wording. It does
 * not catch the failure that actually happens: the same tip rewritten. On
 * 2026-09-09 a 30-post batch contained six reruns — three near-identical "pick a
 * landing spot" chips, two identical "punch out of the trees", and restatements
 * of tips already posted — every one of them with a distinct hook.
 *
 * So this works on the whole script (hook + beats), in two stages:
 *   1. A cheap lexical pass shortlists the most similar existing scripts.
 *   2. Claude judges only that shortlist, which is what catches "set 60% on your
 *      lead foot" and "lean the shaft toward the target" as one piece of advice.
 *
 * Stage 1 alone is too blunt to decide with, but it is very good at putting the
 * true match in the top few, which keeps stage 2 to one API call per batch.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";

// Golf words carry no signal here — nearly every script contains them.
const STOP = new Set(
  ("a an the and or but if then than that this these those you your youre yours it its is are was " +
   "be been being to of in on at for from with without into onto off over under by as so not no " +
   "do dont does did doing have has had having will wont would should could can cant just now " +
   "every each all any some most more less much many one two three too very really actually " +
   "golf golfer golfers ball balls club clubs shot shots swing swings swinging hit hits hitting " +
   "green greens hole holes course play playing player round rounds yard yards foot feet " +
   "get gets getting go goes going make makes making take takes taking put puts putting " +
   "when where what how why who which while because since after before out up down back " +
   "like about right left good bad better best worse never always still even only also").split(/\s+/),
);

const tokens = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9%\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && w.length > 2 && !STOP.has(w));

/** Full text of a script: the hook carries the claim, the beats carry the advice. */
export const scriptText = (s) => [s.hook, ...(s.beats ?? [])].join(" ");

/**
 * Term-frequency cosine over the whole script. Numbers survive tokenizing on
 * purpose — "60" and "80%" are among the strongest signals that two scripts
 * prescribe the same thing.
 */
export function similarity(a, b) {
  const tf = (t) => {
    const m = new Map();
    for (const w of t) m.set(w, (m.get(w) ?? 0) + 1);
    return m;
  };
  const ta = tf(tokens(scriptText(a)));
  const tb = tf(tokens(scriptText(b)));
  if (!ta.size || !tb.size) return 0;
  let dot = 0;
  for (const [w, n] of ta) if (tb.has(w)) dot += n * tb.get(w);
  const mag = (m) => Math.sqrt([...m.values()].reduce((s, n) => s + n * n, 0));
  return dot / (mag(ta) * mag(tb));
}

/** Load every script in a directory as {slug, hook, beats, ...}. */
export function loadCorpus(dirs) {
  const out = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      try {
        const s = JSON.parse(readFileSync(join(dir, f), "utf8"));
        if (s.hook) out.push({ ...s, slug: s.slug ?? basename(f, ".json") });
      } catch {
        /* skip unreadable */
      }
    }
  }
  return out;
}

/** The `n` most lexically similar corpus entries to `candidate`. */
export function shortlist(candidate, corpus, n = 5) {
  return corpus
    .filter((c) => c.slug !== candidate.slug)
    .map((c) => ({ ...c, score: similarity(candidate, c) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}

/**
 * Stage 2: ask Claude which candidates repeat advice already in the corpus.
 *
 * One call per batch, judging only the shortlists. Publication status is part
 * of the prompt on purpose — a tip that duplicates a script which never aired
 * (a failed publish, or something still queued behind it) is not a rerun to
 * anyone watching, and shouldn't be thrown away.
 *
 * Returns [{ slug, duplicate: bool, of: slug|null, why: string }].
 */
export async function judgeDuplicates({
  client,
  candidates,
  corpus,
  model = "claude-sonnet-5",
  shortlistSize = 5,
  batchSize = 8,
  onBatch = null,
}) {
  if (candidates.length === 0) return [];

  // The model reasons before answering, and that thinking shares the output
  // budget, so one call over thirty candidates runs out mid-thought. Batching
  // keeps each call inside its allowance and stops a single unparseable
  // response from costing the whole run.
  if (candidates.length > batchSize) {
    const all = [];
    const batches = Math.ceil(candidates.length / batchSize);
    for (let i = 0; i < candidates.length; i += batchSize) {
      onBatch?.(i / batchSize + 1, batches);
      all.push(
        ...(await judgeDuplicates({
          client,
          candidates: candidates.slice(i, i + batchSize),
          corpus,
          model,
          shortlistSize,
          batchSize,
        })),
      );
    }
    return all;
  }

  const payload = candidates.map((c) => ({
    slug: c.slug,
    hook: c.hook,
    beats: c.beats,
    compare_against: shortlist(c, corpus, shortlistSize).map((s) => ({
      slug: s.slug,
      hook: s.hook,
      beats: s.beats,
      already_posted: Boolean(s.postedAt),
      posted_on: s.postedAt ?? null,
    })),
  }));

  const msg = await client.messages.create({
    model,
    max_tokens: Math.min(16000, 4000 + candidates.length * 1500),
    system:
      "You screen scripts for a golf Instagram account that posts one short tip a day. " +
      "For each candidate, decide whether it gives ADVICE the account has already given. " +
      "Judge the substance, not the wording: two scripts that both say 'pick a landing spot " +
      "instead of aiming at the flag' are the same script even with completely different " +
      "hooks. Same symptom plus same correction means duplicate.\n\n" +
      "It is NOT a duplicate when the situation genuinely differs (a chip's landing spot vs " +
      "an approach target), when the correction differs (lag putting by stroke mechanics vs " +
      "by target selection), or when it merely shares a broad theme like 'course management'. " +
      "A recurring theme is fine; a repeated instruction is not.\n\n" +
      "Weigh already_posted heavily: repeating something that never actually aired is not a " +
      "rerun to viewers, so only flag against an unposted script when they are near-identical.\n\n" +
      'Reply with JSON only: {"verdicts":[{"slug":"...","duplicate":true|false,"of":"slug or null",' +
      '"why":"one short sentence"}]} with one entry per candidate.',
    messages: [{ role: "user", content: JSON.stringify(payload, null, 2) }],
  });

  const text = msg.content.find((c) => c.type === "text")?.text ?? "";
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  try {
    return JSON.parse(json).verdicts ?? [];
  } catch {
    // How much the model thinks before answering varies by batch, so a budget
    // that fits one batch can truncate the next. Halve and retry rather than
    // failing a run nobody is watching.
    if (msg.stop_reason === "max_tokens" && candidates.length > 1) {
      const half = Math.ceil(candidates.length / 2);
      return [
        ...(await judgeDuplicates({ client, candidates: candidates.slice(0, half), corpus, model, shortlistSize, batchSize: half })),
        ...(await judgeDuplicates({ client, candidates: candidates.slice(half), corpus, model, shortlistSize, batchSize: half })),
      ];
    }
    // A judge we can't parse must not silently pass everything through.
    throw new Error(
      `Could not parse duplicate verdicts (stop_reason: ${msg.stop_reason}).\n${text.slice(0, 400)}`,
    );
  }
}
