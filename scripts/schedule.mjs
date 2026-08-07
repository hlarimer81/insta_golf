#!/usr/bin/env node
/**
 * Schedule and auto-post approved Reels to Instagram.
 *
 *   npm run schedule -- plan --per-day 1 --start 2026-08-10 --time 09:00
 *       Queue every approved-but-unqueued Reel, N per day, at a daily time.
 *
 *   npm run schedule -- add your-chips-are-fat-because-you-scoop --at 2026-08-10T09:00
 *       Queue one Reel at a specific time.
 *
 *   npm run schedule -- list
 *       Show the queue (times + status).
 *
 *   npm run schedule -- run            # DRY RUN: shows what's due, posts nothing
 *   npm run schedule -- run --live     # actually posts everything due now
 *   npm run schedule -- run --live --watch   # keep running, posting as items come due
 *
 * The queue lives in queue.json. Times are stored as ISO 8601 (UTC).
 * Nothing posts until it's approved (in scripts/), rendered (in out/), due,
 * and you pass --live.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, basename } from "node:path";
import { publishReel } from "./lib/publish.mjs";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scriptsDir = join(root, "scripts");
const outDir = join(root, "out");
const queuePath = join(root, "queue.json");

// Load ANTHROPIC-style .env so IG/AWS creds are available to `run --live`.
if (existsSync(join(root, ".env"))) {
  try {
    process.loadEnvFile(join(root, ".env"));
  } catch {
    /* ignore */
  }
}

// ---- Queue helpers --------------------------------------------------------
const loadQueue = () =>
  existsSync(queuePath) ? JSON.parse(readFileSync(queuePath, "utf8")) : { entries: [] };
const saveQueue = (q) => writeFileSync(queuePath, JSON.stringify(q, null, 2) + "\n");

const approvedSlugs = () =>
  readdirSync(scriptsDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => basename(f, ".json"));

// ---- Arg parsing ----------------------------------------------------------
const [sub, ...rest] = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith("--")) {
    const key = rest[i].slice(2);
    const next = rest[i + 1];
    if (next && !next.startsWith("--")) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = true; // boolean flag
    }
  } else {
    positional.push(rest[i]);
  }
}

// ---- Subcommands ----------------------------------------------------------
function cmdAdd() {
  const slug = positional[0];
  if (!slug || !flags.at) {
    console.error("Usage: schedule add <slug> --at <ISO date/time>");
    process.exit(1);
  }
  if (!approvedSlugs().includes(slug)) {
    console.error(`"${slug}" is not an approved script in scripts/. Approve it first (npm run review).`);
    process.exit(1);
  }
  const when = new Date(flags.at);
  if (isNaN(when)) {
    console.error(`Couldn't parse --at "${flags.at}". Use e.g. 2026-08-10T09:00`);
    process.exit(1);
  }
  const q = loadQueue();
  if (q.entries.some((e) => e.slug === slug && e.status !== "failed")) {
    console.error(`"${slug}" is already queued. Remove it from queue.json first to reschedule.`);
    process.exit(1);
  }
  q.entries.push(entry(slug, when));
  saveQueue(q);
  console.log(`✅ Queued "${slug}" for ${when.toISOString()}`);
}

function cmdPlan() {
  const perDay = parseInt(flags["per-day"] ?? "1", 10);
  const time = flags.time ?? "09:00";
  const [hh, mm] = time.split(":").map((n) => parseInt(n, 10));
  // Default start: tomorrow (local), at the chosen time.
  const start = flags.start ? new Date(`${flags.start}T00:00`) : new Date(Date.now() + 86400000);
  start.setHours(hh || 9, mm || 0, 0, 0);

  const q = loadQueue();
  const queued = new Set(q.entries.filter((e) => e.status !== "failed").map((e) => e.slug));
  const todo = approvedSlugs().filter((s) => !queued.has(s));

  if (todo.length === 0) {
    console.log("Nothing to plan — every approved Reel is already queued.");
    return;
  }

  let added = 0;
  for (let i = 0; i < todo.length; i++) {
    const day = Math.floor(i / perDay);
    const when = new Date(start);
    when.setDate(when.getDate() + day);
    q.entries.push(entry(todo[i], when));
    console.log(`  ${when.toISOString()}  ${todo[i]}`);
    added++;
  }
  saveQueue(q);
  console.log(`\n✅ Planned ${added} Reel(s), ${perDay} per day from ${start.toDateString()}.`);
}

function cmdList() {
  const q = loadQueue();
  if (q.entries.length === 0) {
    console.log("Queue is empty. Add Reels with \"schedule plan\" or \"schedule add\".");
    return;
  }
  const icon = { pending: "⏳", published: "✅", failed: "❌" };
  const sorted = [...q.entries].sort((a, b) => a.publishAt.localeCompare(b.publishAt));
  for (const e of sorted) {
    const rendered = existsSync(join(outDir, `${e.slug}.mp4`)) ? "" : "  (not rendered)";
    const extra = e.mediaId ? `  media ${e.mediaId}` : e.error ? `  ${e.error}` : "";
    console.log(`${icon[e.status] ?? "•"}  ${e.publishAt}  ${e.slug}${rendered}${extra}`);
  }
}

async function cmdRun() {
  const live = !!flags.live;
  const watch = !!flags.watch;
  const intervalMs = parseInt(flags.interval ?? "60", 10) * 1000;

  if (!live) {
    console.log("DRY RUN — showing what's due. Nothing will be posted. Add --live to post.\n");
  }

  const tick = async () => {
    const q = loadQueue();
    const now = Date.now();
    const due = q.entries.filter(
      (e) => e.status === "pending" && new Date(e.publishAt).getTime() <= now,
    );
    if (due.length === 0) {
      console.log(`[${new Date().toISOString()}] nothing due.`);
      return;
    }
    for (const e of due) {
      try {
        const result = await publishReel({ slug: e.slug, dryRun: !live });
        if (live) {
          e.status = "published";
          e.mediaId = result.mediaId;
          e.postedAt = new Date().toISOString();
          e.error = null;
          saveQueue(q);
          console.log(`✅ posted "${e.slug}" → media ${result.mediaId}`);
        } else {
          console.log(`⏳ WOULD post "${e.slug}" (due ${e.publishAt})`);
          console.log(`   caption: ${result.caption.split("\n")[0]} …`);
        }
      } catch (err) {
        if (live) {
          e.status = "failed";
          e.error = String(err.message ?? err);
          saveQueue(q);
        }
        console.error(`❌ "${e.slug}": ${err.message ?? err}`);
      }
    }
  };

  await tick();
  if (watch) {
    console.log(`\n👀 Watching (every ${intervalMs / 1000}s). Ctrl-C to stop.`);
    setInterval(tick, intervalMs);
  }
}

// Validate credentials and connectivity without posting anything.
async function cmdCheck() {
  const need = ["AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "S3_BUCKET"];
  const missing = need.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`Missing S3 env var(s): ${missing.join(", ")}. See .env.example.`);
    process.exit(1);
  }
  const region = process.env.AWS_REGION;
  const bucket = process.env.S3_BUCKET;

  // Who are these credentials? Confirm it's the account you expect.
  const sts = new STSClient({ region });
  const who = await sts.send(new GetCallerIdentityCommand({}));
  console.log("AWS credentials resolve to:");
  console.log(`  account : ${who.Account}`);
  console.log(`  identity: ${who.Arn}`);
  console.log(`  region  : ${region}`);
  console.log(`  bucket  : ${bucket}\n`);

  // Real round-trip: upload a tiny object, presign it, fetch it back — exactly
  // the mechanism Instagram uses to pull the video, minus the video.
  const s3 = new S3Client({ region });
  const key = `${process.env.S3_PREFIX ?? "reels/"}.healthcheck`;
  const stamp = `insta-golf healthcheck ${new Date().toISOString()}`;
  await s3.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: stamp, ContentType: "text/plain" }),
  );
  const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: 120,
  });
  const res = await fetch(url);
  const body = await res.text();
  if (res.ok && body === stamp) {
    console.log(`✅ S3 upload + presigned fetch round-trip OK (s3://${bucket}/${key})`);
  } else {
    throw new Error(`S3 round-trip failed: status ${res.status}, body mismatch`);
  }

  // Instagram token is optional at this stage — validate it only if present.
  if (process.env.IG_USER_ID && process.env.IG_ACCESS_TOKEN) {
    const v = process.env.GRAPH_API_VERSION ?? "v21.0";
    const p = new URLSearchParams({
      fields: "username,media_count",
      access_token: process.env.IG_ACCESS_TOKEN,
    });
    const r = await fetch(`https://graph.facebook.com/${v}/${process.env.IG_USER_ID}?${p}`);
    const j = await r.json();
    if (r.ok && !j.error) {
      console.log(`✅ Instagram token OK — @${j.username} (${j.media_count} posts)`);
    } else {
      console.log(`❌ Instagram check failed: ${j.error?.message ?? r.statusText}`);
    }
  } else {
    console.log("ℹ️  IG_USER_ID / IG_ACCESS_TOKEN not set yet — skipping Instagram check.");
  }
}

// A fresh queue entry.
function entry(slug, when) {
  return {
    slug,
    publishAt: when.toISOString(),
    status: "pending",
    mediaId: null,
    postedAt: null,
    error: null,
  };
}

// ---- Dispatch -------------------------------------------------------------
switch (sub) {
  case "add":
    cmdAdd();
    break;
  case "plan":
    cmdPlan();
    break;
  case "list":
    cmdList();
    break;
  case "run":
    await cmdRun();
    break;
  case "check":
    await cmdCheck();
    break;
  default:
    console.log(
      "Usage: npm run schedule -- <check|plan|add|list|run> [options]\n" +
        "  check                                   validate AWS/IG creds, no posting\n" +
        "  plan  --per-day N --start YYYY-MM-DD --time HH:MM\n" +
        "  add   <slug> --at <ISO>\n" +
        "  list\n" +
        "  run   [--live] [--watch] [--interval SECONDS]",
    );
    process.exit(sub ? 1 : 0);
}
