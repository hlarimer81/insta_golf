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

const thisWeek = rows.filter((r) => r.date >= curStart && r.date <= curEnd);
const lastWeek = rows.filter((r) => r.date >= prevStart && r.date <= prevEnd);

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
const facts = {
  window: `${curStart} to ${curEnd}`,
  priorWindow: `${prevStart} to ${prevEnd}`,
  thisWeek: {
    posts: thisWeek.length,
    views: sum(thisWeek, "views"),
    avgViews: +avg(thisWeek, "views").toFixed(1),
    likes: sum(thisWeek, "likes"),
    comments: sum(thisWeek, "comments"),
    saves: sum(thisWeek, "saved"),
    shares: sum(thisWeek, "shares"),
    ...cadenceOf(thisWeek, curStart, curEnd),
  },
  priorWeek: {
    posts: lastWeek.length,
    views: sum(lastWeek, "views"),
    avgViews: +avg(lastWeek, "views").toFixed(1),
    ...cadenceOf(lastWeek, prevStart, prevEnd),
  },
  changeInAvgViewsPct: pct(avg(thisWeek, "views"), avg(lastWeek, "views")),
  best: thisWeek.length
    ? thisWeek.reduce((a, b) => ((b.views ?? 0) > (a.views ?? 0) ? b : a))
    : null,
  worst: thisWeek.length
    ? thisWeek.reduce((a, b) => ((b.views ?? 0) < (a.views ?? 0) ? b : a))
    : null,
  perPost: thisWeek.map((r) => ({ date: r.date, slug: r.slug, views: r.views, likes: r.likes })),
  followers: {
    now: account.ok ? account.followers : null,
    // null = the snapshot history doesn't cover that window yet, not zero growth
    netThisWeek: netChange(followerHistory, curStart, curEnd)?.change ?? null,
    netPriorWeek: netChange(followerHistory, prevStart, prevEnd)?.change ?? null,
    newFollowsThisWeek: gainedBetween(curStart, curEnd),
    newFollowsPriorWeek: gainedBetween(prevStart, prevEnd),
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
      "day — that is already the schedule. The goal is followers: say whether this week's " +
      "views turned into any. `followers.netThisWeek` is the net change in follower count; " +
      "null means there isn't a week of daily snapshots yet, so say growth can't be read " +
      "yet rather than calling it flat. `newFollowsThisWeek` is Instagram's own count where " +
      "it exists. Plain prose, no headers, no bullet lists, under " +
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
if (facts.thisWeek.silentDays.length)
  warn.push(
    `${facts.thisWeek.silentDays.length} day(s) with no post: ` +
      `${facts.thisWeek.silentDays.join(", ")}.`,
  );
if (facts.tokenDataAccessDaysLeft != null && facts.tokenDataAccessDaysLeft < 21)
  warn.push(
    `Token data access expires in ${facts.tokenDataAccessDaysLeft} days ` +
      `(${facts.tokenDataAccessExpiresOn}). Re-authorize or everything stops.`,
  );
if (!account.ok) warn.push(`Couldn't read the follower count: ${account.error}.`);

const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]);
const t = facts.thisWeek;
const p = facts.priorWeek;
const fl = facts.followers;
const arrow = facts.changeInAvgViewsPct > 0 ? "▲" : facts.changeInAvgViewsPct < 0 ? "▼" : "—";
const priorNote = p.silentDays.length
  ? `Prior week was partial — no post on ${p.silentDays.join(", ")}, so the post counts ` +
    `are not like for like.`
  : null;
const signed = (n) => (n == null ? "—" : `${n >= 0 ? "+" : ""}${n}`);
// Prefer the measured net change; Instagram's new-follows count stands in where
// the snapshots don't reach back far enough yet.
const gainOf = (net, gained) => (net != null ? net : gained);
const perK = (n, views) => (n == null || !views ? "—" : ((n / views) * 1000).toFixed(1));
const thisGain = gainOf(fl.netThisWeek, fl.newFollowsThisWeek);
const priorGain = gainOf(fl.netPriorWeek, fl.newFollowsPriorWeek);
const followerNote =
  thisGain == null
    ? `Follower growth needs a week of daily snapshots — ${fl.daysOfHistory} recorded so far.`
    : null;

const html = `
<div style="font:15px/1.55 -apple-system,Segoe UI,Helvetica,sans-serif;max-width:620px;color:#1a1a1a">
  <h2 style="margin:0 0 4px">Bogey Golf — week of ${facts.window}</h2>
  ${warn.length ? `<div style="background:#fff4e5;border-left:3px solid #d97706;padding:10px 12px;margin:14px 0">${warn.map((w) => `<div>⚠️ ${esc(w)}</div>`).join("")}</div>` : ""}
  <p style="white-space:pre-wrap">${esc(read)}</p>
  <table style="border-collapse:collapse;margin:18px 0;font-size:14px">
    <tr style="background:#f4f4f5"><th align="left" style="padding:6px 12px">&nbsp;</th>
      <th align="right" style="padding:6px 12px">This week</th><th align="right" style="padding:6px 12px">Prior</th></tr>
    <tr><td style="padding:6px 12px">Followers</td><td align="right" style="padding:6px 12px"><b>${fl.now ?? "—"}</b> (${signed(thisGain)})</td><td align="right" style="padding:6px 12px">${signed(priorGain)}</td></tr>
    <tr><td style="padding:6px 12px">Followers / 1k views</td><td align="right" style="padding:6px 12px">${perK(thisGain, t.views)}</td><td align="right" style="padding:6px 12px">${perK(priorGain, p.views)}</td></tr>
    <tr><td style="padding:6px 12px">Posts</td><td align="right" style="padding:6px 12px">${t.posts}${t.silentDays.length ? ` <span style="color:#b45309">(${t.silentDays.length} silent day${t.silentDays.length > 1 ? "s" : ""})</span>` : ""}</td><td align="right" style="padding:6px 12px">${p.posts}${p.silentDays.length ? ` <span style="color:#b45309">(${p.silentDays.length} silent)</span>` : ""}</td></tr>
    <tr><td style="padding:6px 12px">Views</td><td align="right" style="padding:6px 12px">${t.views.toLocaleString()}</td><td align="right" style="padding:6px 12px">${p.views.toLocaleString()}</td></tr>
    <tr><td style="padding:6px 12px">Avg / post</td><td align="right" style="padding:6px 12px"><b>${t.avgViews}</b> ${arrow} ${Math.abs(facts.changeInAvgViewsPct)}%</td><td align="right" style="padding:6px 12px">${p.avgViews}</td></tr>
    <tr><td style="padding:6px 12px">Likes / comments</td><td align="right" style="padding:6px 12px">${t.likes} / ${t.comments}</td><td align="right" style="padding:6px 12px">—</td></tr>
    <tr><td style="padding:6px 12px">Saves / shares</td><td align="right" style="padding:6px 12px">${t.saves} / ${t.shares}</td><td align="right" style="padding:6px 12px">—</td></tr>
  </table>
  <div style="font-size:13px;color:#555">
    ${facts.best ? `Best: <b>${esc(facts.best.slug)}</b> (${facts.best.views} views)<br>` : ""}
    ${facts.worst && facts.worst.slug !== facts.best?.slug ? `Weakest: ${esc(facts.worst.slug)} (${facts.worst.views} views)<br>` : ""}
    ${priorNote ? `${esc(priorNote)}<br>` : ""}
    ${followerNote ? `${esc(followerNote)}<br>` : ""}
    Queue: ${facts.queueRemaining} posts through ${facts.queueThrough ?? "—"}.
  </div>
</div>`.trim();

const text =
  `Bogey Golf — week of ${facts.window}\n\n` +
  (warn.length ? warn.map((w) => `! ${w}`).join("\n") + "\n\n" : "") +
  `${read}\n\n` +
  `Followers ${fl.now ?? "—"} (${signed(thisGain)} this week, ${signed(priorGain)} prior)\n` +
  (followerNote ? `${followerNote}\n` : "") +
  `Posts ${t.posts} (prior ${p.posts})\nViews ${t.views} (prior ${p.views})\n` +
  (priorNote ? `${priorNote}\n` : "") +
  `Avg/post ${t.avgViews} vs ${p.avgViews} (${facts.changeInAvgViewsPct >= 0 ? "+" : ""}${facts.changeInAvgViewsPct}%)\n` +
  `Likes ${t.likes}, comments ${t.comments}, saves ${t.saves}, shares ${t.shares}\n` +
  `Queue: ${facts.queueRemaining} posts through ${facts.queueThrough ?? "—"}\n`;

const subject =
  `Bogey Golf: ${fl.now ?? "?"} followers (${signed(thisGain)}), ${t.views.toLocaleString()} views` +
  (warn.length ? ` — ${warn.length} thing(s) need you` : "");

// Markdown copy for the GitHub issue the workflow opens. That issue is the
// delivery that actually lands: GitHub mails it from its own domain, whereas
// SES sending "from" a gmail.com address looks spoofed to Gmail and
// never reached the inbox. It also leaves every report readable in the repo.
const mdRow = (a, b, c) => `| ${a} | ${b} | ${c} |`;
const md = [
  ...(warn.length ? [warn.map((w) => `> ⚠️ ${w}`).join("\n>\n"), ""] : []),
  read,
  "",
  mdRow("", "This week", "Prior"),
  "|---|--:|--:|",
  mdRow("Followers", `**${fl.now ?? "—"}** (${signed(thisGain)})`, signed(priorGain)),
  mdRow("Followers / 1k views", perK(thisGain, t.views), perK(priorGain, p.views)),
  mdRow("Posts", `${t.posts}${t.silentDays.length ? ` (${t.silentDays.length} silent)` : ""}`, `${p.posts}${p.silentDays.length ? ` (${p.silentDays.length} silent)` : ""}`),
  mdRow("Views", t.views.toLocaleString(), p.views.toLocaleString()),
  mdRow("Avg / post", `**${t.avgViews}** ${arrow} ${Math.abs(facts.changeInAvgViewsPct)}%`, p.avgViews),
  mdRow("Likes / comments", `${t.likes} / ${t.comments}`, "—"),
  mdRow("Saves / shares", `${t.saves} / ${t.shares}`, "—"),
  "",
  ...(facts.best ? [`Best: **${facts.best.slug}** (${facts.best.views} views)  `] : []),
  ...(facts.worst && facts.worst.slug !== facts.best?.slug ? [`Weakest: ${facts.worst.slug} (${facts.worst.views} views)  `] : []),
  ...(priorNote ? [`${priorNote}  `] : []),
  ...(followerNote ? [`${followerNote}  `] : []),
  `Queue: ${facts.queueRemaining} posts through ${facts.queueThrough ?? "—"}.`,
].join("\n");

const outDir = join(root, "out");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "report.md"), md + "\n");
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
