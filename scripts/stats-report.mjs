#!/usr/bin/env node
/**
 * Weekly performance report, emailed via SES.
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
 *      REPORT_FROM (a verified SES identity), REPORT_TO.
 * Run weekly by .github/workflows/keep-queue-full.yml.
 */
import Anthropic from "@anthropic-ai/sdk";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { makeS3, getJson } from "./lib/s3.mjs";
import { fetchStats, tokenHealth, sum, avg } from "./lib/ig-stats.mjs";

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
if (!dryRun) need.push("REPORT_FROM", "REPORT_TO");
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
  queueRemaining: upcoming.length,
  queueThrough: upcoming.length ? upcoming[upcoming.length - 1].publishAt.slice(0, 10) : null,
  failedEntries: failed.map((e) => e.slug),
  tokenDataAccessDaysLeft: health.dataAccessExpiresInDays,
  tokenDataAccessExpiresOn: health.dataAccessExpiresOn,
};

// ---- have Claude write the read -------------------------------------------
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
    "day — that is already the schedule. Plain prose, no headers, no bullet lists, under " +
    "200 words. Do not repeat the raw numbers back — they appear in a table beneath your " +
    "text.",
  messages: [{ role: "user", content: JSON.stringify(facts, null, 2) }],
});
const read = msg.content.find((c) => c.type === "text")?.text ?? "(no summary generated)";

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

const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]);
const t = facts.thisWeek;
const p = facts.priorWeek;
const arrow = facts.changeInAvgViewsPct > 0 ? "▲" : facts.changeInAvgViewsPct < 0 ? "▼" : "—";
const priorNote = p.silentDays.length
  ? `Prior week was partial — no post on ${p.silentDays.join(", ")}, so the post counts ` +
    `are not like for like.`
  : null;

const html = `
<div style="font:15px/1.55 -apple-system,Segoe UI,Helvetica,sans-serif;max-width:620px;color:#1a1a1a">
  <h2 style="margin:0 0 4px">Bogey Golf — week of ${facts.window}</h2>
  ${warn.length ? `<div style="background:#fff4e5;border-left:3px solid #d97706;padding:10px 12px;margin:14px 0">${warn.map((w) => `<div>⚠️ ${esc(w)}</div>`).join("")}</div>` : ""}
  <p style="white-space:pre-wrap">${esc(read)}</p>
  <table style="border-collapse:collapse;margin:18px 0;font-size:14px">
    <tr style="background:#f4f4f5"><th align="left" style="padding:6px 12px">&nbsp;</th>
      <th align="right" style="padding:6px 12px">This week</th><th align="right" style="padding:6px 12px">Prior</th></tr>
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
    Queue: ${facts.queueRemaining} posts through ${facts.queueThrough ?? "—"}.
  </div>
</div>`.trim();

const text =
  `Bogey Golf — week of ${facts.window}\n\n` +
  (warn.length ? warn.map((w) => `! ${w}`).join("\n") + "\n\n" : "") +
  `${read}\n\n` +
  `Posts ${t.posts} (prior ${p.posts})\nViews ${t.views} (prior ${p.views})\n` +
  (priorNote ? `${priorNote}\n` : "") +
  `Avg/post ${t.avgViews} vs ${p.avgViews} (${facts.changeInAvgViewsPct >= 0 ? "+" : ""}${facts.changeInAvgViewsPct}%)\n` +
  `Likes ${t.likes}, comments ${t.comments}, saves ${t.saves}, shares ${t.shares}\n` +
  `Queue: ${facts.queueRemaining} posts through ${facts.queueThrough ?? "—"}\n`;

if (dryRun) {
  console.log(text);
  console.log("\n--dry-run: nothing sent.");
  process.exit(0);
}

const ses = new SESv2Client({ region: process.env.AWS_REGION });
await ses.send(
  new SendEmailCommand({
    FromEmailAddress: process.env.REPORT_FROM,
    Destination: { ToAddresses: [process.env.REPORT_TO] },
    Content: {
      Simple: {
        Subject: {
          Data:
            `Bogey Golf: ${t.posts} posts, ${t.views.toLocaleString()} views` +
            (warn.length ? ` — ${warn.length} thing(s) need you` : ""),
        },
        Body: { Html: { Data: html }, Text: { Data: text } },
      },
    },
  }),
);
console.log(`✅ Report sent to ${process.env.REPORT_TO}.`);
