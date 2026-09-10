#!/usr/bin/env node
/**
 * Audit queued scripts for advice the account has already given.
 *
 *   npm run dedupe                      # check everything still queued
 *   npm run dedupe -- <slug> [<slug>]   # check specific scripts
 *   npm run dedupe -- --fix             # regenerate the duplicates in place
 *
 * The generator dedupes on hooks, which only catches repeated wording. This
 * catches the same tip rewritten — the failure that actually happens. See
 * scripts/lib/dedupe.mjs for how the two stages work.
 *
 * With --fix, each duplicate is unqueued, filed under scripts/rejected/ so the
 * generator can see it, replaced with a freshly generated script, rendered, and
 * enqueued on the date it freed up. Without --fix nothing is changed.
 */
import Anthropic from "@anthropic-ai/sdk";
import { spawnSync } from "node:child_process";
import { renameSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { makeS3, getJson } from "./lib/s3.mjs";
import { loadCorpus, judgeDuplicates, shortlist } from "./lib/dedupe.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scriptsDir = join(root, "scripts");
const rejectedDir = join(scriptsDir, "rejected");
const draftsDir = join(scriptsDir, "drafts");

if (existsSync(join(root, ".env"))) {
  try {
    process.loadEnvFile(join(root, ".env"));
  } catch {
    /* ignore */
  }
}
for (const k of ["AWS_REGION", "S3_BUCKET", "ANTHROPIC_API_KEY"]) {
  if (!process.env[k]) {
    console.error(`Missing ${k}. See .env.example.`);
    process.exit(1);
  }
}

const argv = process.argv.slice(2);
const fix = argv.includes("--fix");
const only = argv.filter((a) => !a.startsWith("--"));

const s3 = makeS3(process.env.AWS_REGION);
const queue = (await getJson(s3, {
  bucket: process.env.S3_BUCKET,
  key: process.env.CLOUD_QUEUE_KEY ?? "queue.json",
})) ?? { entries: [] };

// Only compare against what an audience has seen or is going to see. Scripts
// sitting in scripts/ that were never queued — rejected drafts, and casualties
// like your-driver-is-teed-too-low, which failed to publish on 2026-08-21 and
// was dropped — are invisible to viewers, so repeating them isn't a rerun.
const postedAt = new Map(queue.entries.filter((e) => e.postedAt).map((e) => [e.slug, e.postedAt]));
const live = new Set(
  queue.entries.filter((e) => e.status === "published" || e.status === "pending").map((e) => e.slug),
);
const corpus = loadCorpus([scriptsDir]).filter((c) => live.has(c.slug));
for (const c of corpus) c.postedAt = postedAt.get(c.slug) ?? null;

const pending = queue.entries
  .filter((e) => e.status === "pending" && new Date(e.publishAt).getTime() > Date.now())
  .sort((a, b) => a.publishAt.localeCompare(b.publishAt));

const wanted = only.length ? new Set(only) : new Set(pending.map((e) => e.slug));
const candidates = corpus.filter((c) => wanted.has(c.slug));
if (candidates.length === 0) {
  console.log("Nothing to check.");
  process.exit(0);
}

console.log(`Checking ${candidates.length} script(s) against ${corpus.length} in the corpus…\n`);
const verdicts = await judgeDuplicates({
  client: new Anthropic(),
  candidates,
  corpus,
  onBatch: (n, of) => process.stdout.write(`  batch ${n}/${of}…\r`),
});
process.stdout.write("".padEnd(24) + "\r");
const dupes = verdicts.filter((v) => v.duplicate);

for (const v of verdicts.filter((v) => !v.duplicate)) {
  const top = shortlist(
    corpus.find((c) => c.slug === v.slug),
    corpus,
    1,
  )[0];
  console.log(`  ok   ${v.slug}  (closest: ${top?.slug ?? "—"} ${top ? top.score.toFixed(2) : ""})`);
}
for (const v of dupes) {
  const at = pending.find((e) => e.slug === v.slug)?.publishAt.slice(0, 10) ?? "not queued";
  console.log(`\n  DUP  ${v.slug}  [${at}]`);
  console.log(`       repeats: ${v.of}`);
  console.log(`       ${v.why}`);
}

// Two queued scripts can each be flagged as repeating the other. Only one is
// redundant, so keep whichever airs first and replace the later one.
const whenOf = new Map(pending.map((e) => [e.slug, e.publishAt]));
const flagged = new Set(dupes.map((d) => d.slug));
const survivors = new Set();
const toReplace = [];
for (const d of [...dupes].sort((a, b) =>
  (whenOf.get(a.slug) ?? "").localeCompare(whenOf.get(b.slug) ?? ""),
)) {
  const mine = whenOf.get(d.slug);
  const theirs = whenOf.get(d.of);
  if (flagged.has(d.of) && !survivors.has(d.of) && mine && theirs && mine < theirs) {
    survivors.add(d.slug);
    console.log(`\n  keep ${d.slug} [${mine.slice(0, 10)}] — it airs before ${d.of}, which goes instead`);
    continue;
  }
  toReplace.push(d);
}

console.log(`\n${toReplace.length} duplicate(s) of ${candidates.length} checked.`);
if (toReplace.length === 0) process.exit(0);
if (!fix) {
  console.log("Re-run with --fix to replace them.");
  process.exit(0);
}

// ---- fix: unqueue, file away, regenerate, render, re-enqueue ---------------
const run = (args, quiet = true) => {
  const res = spawnSync("node", args, {
    cwd: root,
    stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
  });
  if (res.status !== 0) {
    console.error(res.stderr?.slice(-600) ?? "");
    throw new Error(`step failed: ${args.join(" ")}`);
  }
  return res.stdout ?? "";
};

mkdirSync(rejectedDir, { recursive: true });
// A replacement has to be the same kind as what it replaces — regenerating a
// joke slot as a tip quietly erodes the humor cadence.
const slots = { tip: [], joke: [] };
for (const v of toReplace) {
  const script = corpus.find((c) => c.slug === v.slug);
  const kind = script?.kind === "joke" ? "joke" : "tip";
  const entry = pending.find((e) => e.slug === v.slug);
  if (!entry) {
    console.log(`  (${v.slug} isn't queued — filing it away only)`);
  } else {
    run(["scripts/enqueue.mjs", "remove", v.slug]);
    slots[kind].push(entry.publishAt);
  }
  renameSync(join(scriptsDir, `${v.slug}.json`), join(rejectedDir, `${v.slug}.json`));
  console.log(`  removed ${v.slug} (${kind})`);
}

const SUBJECT = {
  tip: "shots and situations this account has not covered yet — read scripts/ for what it already has",
  joke: "the everyday indignities of weekend golf, on ground this account hasn't already joked about",
};

let replaced = 0;
for (const kind of ["tip", "joke"]) {
  const want = slots[kind];
  if (want.length === 0) continue;
  console.log(`\nGenerating ${want.length} ${kind} replacement(s)…`);
  const before = existsSync(draftsDir) ? new Set(readdirSync(draftsDir)) : new Set();
  run(["scripts/generate.mjs", "--count", String(want.length), "--kind", kind, SUBJECT[kind]], false);
  const fresh = (existsSync(draftsDir) ? readdirSync(draftsDir) : [])
    .filter((f) => f.endsWith(".json") && !before.has(f))
    .sort();

  want.sort();
  for (const [i, file] of fresh.entries()) {
    if (i >= want.length) break;
    const slug = file.replace(/\.json$/, "");
    renameSync(join(draftsDir, file), join(scriptsDir, file));
    console.log(`  ${slug} → ${want[i].slice(0, 10)}`);
    try {
      run(["scripts/bg.mjs", slug, "--ratio", "9:16"]);
    } catch {
      console.log("    (no background — continuing)");
    }
    run(["scripts/render.mjs", `scripts/${slug}.json`]);
    run(["scripts/enqueue.mjs", slug, "--at", want[i]]);
    replaced++;
  }
  // The generator can overshoot; don't leave strays for a later run to promote.
  for (const file of fresh.slice(want.length)) {
    renameSync(join(draftsDir, file), join(rejectedDir, file));
  }
}
if (replaced === 0) process.exit(0);
console.log(`\n✅ Replaced ${replaced} duplicate(s).`);
console.log("   Re-run `npm run dedupe` to confirm the replacements are clean.");
