#!/usr/bin/env node
/**
 * Weekly performance report — posted as a GitHub issue by the workflow, and
 * emailed via SES when configured.
 *
 *   npm run report                 # build and send
 *   npm run report -- --dry-run    # print to stdout, send nothing
 *
 * Pulls the same numbers as `npm run stats`, compares the last 7 days against
 * the 7 before, checks how much runway the queue and the access token have
 * left, and asks Claude to write the read. The narrative is the point — a table
 * of numbers doesn't tell you that views fell because a format changed.
 *
 * Env: AWS_REGION, S3_BUCKET, IG_ACCESS_TOKEN, ANTHROPIC_API_KEY,
 *      optionally REPORT_FROM (a verified SES identity) + REPORT_TO for email.
 * Run weekly by .github/workflows/keep-queue-full.yml.
 */
import Anthropic from "@anthropic-ai/sdk";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { makeS3, getJson } from "./lib/s3.mjs";
import { fetchStats, tokenHealth, sum, avg, fetchAccount, fetchFollowerGains } from "./lib/ig-stats.mjs";
import { loadFollowerHistory, recordFollowers, netChange } from "./lib/followers.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (existsSync(join(root, ".env"))) {
  try {
    process.loadEnvFile(join(root, ".env"));
  } catch {
    /* ignore */
  }
}

const dryRun = process.argv.includes("--dry-run");
const need = ["AWS_REGION", "S3_BUCKET", "IG_ACCESS_TOKEN", "ANTHROPIC_API_KEY"];
for (const k of need) {
  if (!process.env[k]) {
    console.error(`Missing ${k}.`);
    process.exit(1);
  }
}

const version = process.env.GRAPH_API_VERSION ?? "v21.0";
const token = process.env.IG_ACCESS_TOKEN;

// ---- gather ---------------------------------------------------------------
const s3 = makeS3(process.env.AWS_REGION);
const queue = (await getJson(s3, {
  bucket: process.env.S3_BUCKET,
  key: process.env.CLOUD_QUEUE_KEY ?? "queue.json",
})) ?? { entries: [] };

const { rows } = await fetchStats({
  token,
  version,
  metrics: (process.env.IG_INSIGHT_METRICS ?? "views,reach,saved,shares").split(","),
  entries: queue.entries,
});

const dayAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

// Seven dates each, inclusive at both ends. The old boundary (`>= dayAgo(7)`)
// made the current window eight days long against a seven-day prior one, which
// by itself inflated this week's post count.
const curStart = dayAgo(6);
const curEnd = dayAgo(0);
const prevStart = dayAgo(13);
const prevEnd = dayAgo(7);

// Views keep climbing for days after a post, so last week's posts always look
// stronger than this week's. On Oct 16 that read as "views dropped a third"
// when the newest posts were hours old. Views are judged on posts 7–13 days
// old against 14–20 (both settled); the latest week is reported as "so far".
const oldStart = dayAgo(20);
const oldEnd = dayAgo(14);

const thisWeek = rows.filter((r) => r.date >= curStart && r.date <= curEnd);
const lastWeek = rows.filter((r) => r.date >= prevStart && r.date <= prevEnd);
const weekBefore = rows.filter((r) => r.date >= oldStart && r.date <= oldEnd);

// The account posts once a day, so a fall in post count means days were missed
// — a drained queue or a failed publish — not a change of schedule. Reporting
// the silent dates alongside posts-per-active-day keeps those apart, which is
// the difference between "we had an outage" and "cadence halved".
const datesBetween = (a, b) => {
  const out = [];
  for (let d = new Date(a + "T00:00:00Z"); d.toISOString().slice(0, 10) <= b; d.setUTCDate(d.getUTCDate() + 1))
    out.push(d.toISOString().slice(0, 10));
  return out;
};
const cadenceOf = (rs, a, b) => {
  const posted = new Set(rs.map((r) => r.date));
  return {
    activeDays: posted.size,
    silentDays: datesBetween(a, b).filter((d) => !posted.has(d)),
    postsPerActiveDay: posted.size ? +(rs.length / posted.size).toFixed(2) : 0,
  };
};

const now = Date.now();
const upcoming = queue.entries
  .filter((e) => e.status === "pending" && new Date(e.publishAt).getTime() > now)
  .sort((a, b) => a.publishAt.localeCompare(b.publishAt));
const failed = queue.entries.filter((e) => e.status === "failed");
const health = await tokenHealth({ token, version });

// Followers are what the views are for. Net change comes from the daily S3
// snapshots; this run records one too, so a missed top-up day still leaves a
// weekly point. Instagram's own new-follows series only exists at 100+.
const account = await fetchAccount({ token, version });
let followerHistory = [];
try {
  followerHistory = await loadFollowerHistory(s3, process.env.S3_BUCKET);
  if (account.ok && typeof account.followers === "number" && !dryRun)
    followerHistory = await recordFollowers(s3, process.env.S3_BUCKET, { followers: account.followers });
} catch (e) {
  console.error(`⚠️  Follower history unavailable: ${e.message}`);
}
const gains = account.ok ? await fetchFollowerGains({ token, version, igUserId: account.id }) : { ok: false };
const gainedBetween = (a, b) =>
  gains.ok ? sum(gains.daily.filter((d) => d.date >= a && d.date <= b), "gained") : null;

const pct = (a, b) => (b === 0 ? (a === 0 ? 0 : 100) : Math.round(((a - b) / b) * 100));
const weekStats = (rs, a, b) => ({
  window: `${a} to ${b}`,
  posts: rs.length,
  views: sum(rs, "views"),
  avgViews: +avg(rs, "views").toFixed(1),
  likes: sum(rs, "likes"),
  comments: sum(rs, "comments"),
  saves: sum(rs, "saved"),
  shares: sum(rs, "shares"),
  ...cadenceOf(rs, a, b),
  // Followers gained over the same dates the posts went out.
  followerNet: netChange(followerHistory, a, b)?.change ?? null,
  newFollows: gainedBetween(a, b),
});
const counted = weekStats(lastWeek, prevStart, prevEnd);
const countedPrior = weekStats(weekBefore, oldStart, oldEnd);
const facts = {
  // Settled posts: the only fair week-over-week view comparison.
  counted,
  countedPrior,
  changeInAvgViewsPct: pct(counted.avgViews, countedPrior.avgViews),
  best: lastWeek.length
    ? lastWeek.reduce((a, b) => ((b.views ?? 0) > (a.views ?? 0) ? b : a))
    : null,
  worst: lastWeek.length
    ? lastWeek.reduce((a, b) => ((b.views ?? 0) < (a.views ?? 0) ? b : a))
    : null,
  perPost: lastWeek.map((r) => ({ date: r.date, slug: r.slug, views: r.views, likes: r.likes, saves: r.saved, shares: r.shares })),
  // The latest week: cadence and follower news are current, views are not final.
  fresh: {
    ...weekStats(thisWeek, curStart, curEnd),
    perPost: thisWeek.map((r) => ({ date: r.date, slug: r.slug, viewsSoFar: r.views })),
  },
  followers: {
    now: account.ok ? account.followers : null,
    daysOfHistory: followerHistory.length,
  },
  queueRemaining: upcoming.length,
  queueThrough: upcoming.length ? upcoming[upcoming.length - 1].publishAt.slice(0, 10) : null,
  failedEntries: failed.map((e) => e.slug),
  tokenDataAccessDaysLeft: health.dataAccessExpiresInDays,
  tokenDataAccessExpiresOn: health.dataAccessExpiresOn,
};

// ---- have Claude write the read -------------------------------------------
// A Claude outage or spend cap must not cost the owner the numbers: on Oct 12
// the API limit killed the whole report. Fall back to the table alone.
let read;
try {
  const client = new Anthropic();
  const msg = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 1200,
    system:
      "You write a short weekly performance note for a faceless golf Instagram account " +
      "to its owner. You have the numbers; your job is the interpretation. Lead with what " +
      "changed and why it plausibly changed. Be concrete and honest — if a week was flat, " +
      "say it was flat rather than dressing it up. Call out anything that needs a human " +
      "decision. Known account context: Reels vastly outperform static posts (74 vs 5 avg " +
      "views), posting twice a day split reach rather than adding it, and jokes and tips " +
      "perform about the same. Engagement has been near zero across the account's life, so " +
      "treat a single save or share as genuinely notable. " +
      "Cadence: this account publishes once a day, every day. Never read a difference in " +
      "post count between the two windows as a cadence change — it almost always means days " +
      "were missed because the queue drained or a publish failed. `silentDays` lists the " +
      "dates in each window with no post, and `postsPerActiveDay` stays near 1.0 whenever " +
      "the schedule is intact; only call cadence changed if that number moved. If the prior " +
      "window has silent days, say plainly that the comparison is against a partial week " +
      "instead of reporting the rise as growth. Never suggest cutting back to one post a " +
      "day — that is already the schedule. " +
      "Views keep accumulating for about a week after a post. `counted` (posts 7–13 days " +
      "old) and `countedPrior` (14–20 days old) have settled, so compare views only between " +
      "those two. `fresh` is the last 7 days: its views are still climbing, so never compare " +
      "it with anything, never call a fresh post weak for low views, and never read a " +
      "within-week fade as a decline — the newest posts are always lowest. Use `fresh` only " +
      "for cadence, follower and engagement news. " +
      "Since 2026-10-17 new scripts are ~10s Reels (were ~24s) ending on a save/send call " +
      "to action, with the same ask in captions; posts already queued then went out in the " +
      "old format. Watch for saves, shares and comments moving off zero. " +
      "The goal is followers: say whether views turned into any. `followerNet` is the net " +
      "follower change over a window's dates and `newFollows` Instagram's own count where it " +
      "exists; null means the daily snapshots don't reach back that far yet, so say growth " +
      "can't be read yet rather than calling it flat. Plain prose, no headers, no bullet lists, under " +
      "200 words. Do not repeat the raw numbers back — they appear in a table beneath your " +
      "text.",
    messages: [{ role: "user", content: JSON.stringify(facts, null, 2) }],
  });
  read = msg.content.find((c) => c.type === "text")?.text ?? "(no summary generated)";
} catch (e) {
  console.error(`⚠️  Claude read failed, sending numbers only: ${e.message}`);
  read = `(No written read this week — the Claude call failed: ${e.message.slice(0, 200)})`;
}

// ---- format ---------------------------------------------------------------
const warn = [];
if (facts.queueRemaining < 7)
  warn.push(`Queue is down to ${facts.queueRemaining} post(s) — through ${facts.queueThrough}.`);
if (facts.failedEntries.length)
  warn.push(`Failed to publish: ${facts.failedEntries.join(", ")}.`);
if (facts.fresh.silentDays.length)
  warn.push(
    `${facts.fresh.silentDays.length} day(s) with no post: ` +
      `${facts.fresh.silentDays.join(", ")}.`,
  );
if (facts.tokenDataAccessDaysLeft != null && facts.tokenDataAccessDaysLeft < 21)
  warn.push(
    `Token data access expires in ${facts.tokenDataAccessDaysLeft} days ` +
      `(${facts.tokenDataAccessExpiresOn}). Re-authorize or everything stops.`,
  );
if (!account.ok) warn.push(`Couldn't read the follower count: ${account.error}.`);

const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]);
const t = facts.counted;
const p = facts.countedPrior;
const f = facts.fresh;
const fl = facts.followers;
const arrow = facts.changeInAvgViewsPct > 0 ? "▲" : facts.changeInAvgViewsPct < 0 ? "▼" : "—";
const signed = (n) => (n == null ? "—" : `${n >= 0 ? "+" : ""}${n}`);
// Prefer the measured net change; Instagram's new-follows count stands in where
// the snapshots don't reach back far enough yet.
const gainOf = (w) => (w.followerNet != null ? w.followerNet : w.newFollows);
const perK = (n, views) => (n == null || !views ? "—" : ((n / views) * 1000).toFixed(1));
const md = (iso) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const span = (w) => w.window.split(" to ").map(md).join("–");
const silentNote = (w) => (w.silentDays.length ? ` (${w.silentDays.length} silent)` : "");

const notes = [
  `Views compare posts from ${span(t)} with ${span(p)} — both old enough that their views have settled.`,
  `Last 7 days (${span(f)}): ${f.posts} posts, ${f.views.toLocaleString()} views so far and still climbing; ` +
    `${f.saves} saves, ${f.shares} shares, ${f.comments} comments.`,
  ...(p.silentDays.length
    ? [`${span(p)} was partial — no post on ${p.silentDays.join(", ")}, so post counts are not like for like.`]
    : []),
  ...(gainOf(f) == null
    ? [`Follower growth needs a week of daily snapshots — ${fl.daysOfHistory} recorded so far.`]
    : []),
  ...(facts.best ? [`Best settled post: ${facts.best.slug} (${facts.best.views} views)`] : []),
  ...(facts.worst && facts.worst.slug !== facts.best?.slug
    ? [`Weakest: ${facts.worst.slug} (${facts.worst.views} views)`]
    : []),
  `Queue: ${facts.queueRemaining} posts through ${facts.queueThrough ?? "—"}.`,
];

// [label, settled week, week before] — one table for the email and the issue.
const table = [
  ["Followers gained", signed(gainOf(t)), signed(gainOf(p))],
  ["Followers / 1k views", perK(gainOf(t), t.views), perK(gainOf(p), p.views)],
  ["Posts", `${t.posts}${silentNote(t)}`, `${p.posts}${silentNote(p)}`],
  ["Views", t.views.toLocaleString(), p.views.toLocaleString()],
  ["Avg / post", `${t.avgViews} ${arrow} ${Math.abs(facts.changeInAvgViewsPct)}%`, String(p.avgViews)],
  ["Likes / comments", `${t.likes} / ${t.comments}`, `${p.likes} / ${p.comments}`],
  ["Saves / shares", `${t.saves} / ${t.shares}`, `${p.saves} / ${p.shares}`],
];
const followersLine = `Followers: ${fl.now ?? "—"} (${signed(gainOf(f))} in the last 7 days)`;

const td = (s, align = "right") => `<td align="${align}" style="padding:6px 12px">${esc(s)}</td>`;
const html = `
<div style="font:15px/1.55 -apple-system,Segoe UI,Helvetica,sans-serif;max-width:620px;color:#1a1a1a">
  <h2 style="margin:0 0 4px">Bogey Golf — week to ${md(curEnd)}</h2>
  <div style="font-size:17px;margin:4px 0 0"><b>${esc(followersLine)}</b></div>
  ${warn.length ? `<div style="background:#fff4e5;border-left:3px solid #d97706;padding:10px 12px;margin:14px 0">${warn.map((w) => `<div>⚠️ ${esc(w)}</div>`).join("")}</div>` : ""}
  <p style="white-space:pre-wrap">${esc(read)}</p>
  <table style="border-collapse:collapse;margin:18px 0;font-size:14px">
    <tr style="background:#f4f4f5">${td("", "left")}${td(`Posted ${span(t)}`)}${td(span(p))}</tr>
    ${table.map(([a, b, c]) => `<tr>${td(a, "left")}${td(b)}${td(c)}</tr>`).join("\n    ")}
  </table>
  <div style="font-size:13px;color:#555">${notes.map(esc).join("<br>")}</div>
</div>`.trim();

const text =
  `Bogey Golf — week to ${md(curEnd)}\n${followersLine}\n\n` +
  (warn.length ? warn.map((w) => `! ${w}`).join("\n") + "\n\n" : "") +
  `${read}\n\n` +
  `Posted ${span(t)} vs ${span(p)}:\n` +
  table.map(([a, b, c]) => `${a}: ${b} (vs ${c})`).join("\n") +
  `\n\n${notes.join("\n")}\n`;

const subject =
  `Bogey Golf: ${fl.now ?? "?"} followers (${signed(gainOf(f))}), ${t.avgViews} avg views/post` +
  (warn.length ? ` — ${warn.length} thing(s) need you` : "");

// Markdown copy for the GitHub issue the workflow opens. That issue is the
// delivery that actually lands: GitHub mails it from its own domain, whereas
// SES sending "from" a gmail.com address looks spoofed to Gmail and
// never reached the inbox. It also leaves every report readable in the repo.
const mdRow = (cells) => `| ${cells.join(" | ")} |`;
const mdBody = [
  `**${followersLine}**`,
  "",
  ...(warn.length ? [warn.map((w) => `> ⚠️ ${w}`).join("\n>\n"), ""] : []),
  read,
  "",
  mdRow(["", `Posted ${span(t)}`, span(p)]),
  "|---|--:|--:|",
  ...table.map(mdRow),
  "",
  notes.join("  \n"),
].join("\n");

const outDir = join(root, "out");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "report.md"), mdBody + "\n");
writeFileSync(join(outDir, "report-subject.txt"), subject + "\n");

if (dryRun) {
  console.log(text);
  console.log("\n--dry-run: nothing sent. Markdown copy in out/report.md.");
  process.exit(0);
}

// Best effort: the issue is the delivery that counts, so a bounce here
// mustn't fail the job and take the issue with it.
if (process.env.REPORT_FROM && process.env.REPORT_TO) {
  try {
    const ses = new SESv2Client({ region: process.env.AWS_REGION });
    await ses.send(
      new SendEmailCommand({
        FromEmailAddress: process.env.REPORT_FROM,
        Destination: { ToAddresses: [process.env.REPORT_TO] },
        Content: {
          Simple: {
            Subject: { Data: subject },
            Body: { Html: { Data: html }, Text: { Data: text } },
          },
        },
      }),
    );
    console.log(`SES accepted the email to ${process.env.REPORT_TO} (accepted is not delivered).`);
  } catch (e) {
    console.error(`⚠️  SES send failed: ${e.message}`);
  }
}
console.log("✅ Report written to out/report.md.");
