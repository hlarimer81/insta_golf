# insta-golf — status

_Last updated: 2026-09-09_

## ⚠️ Action required: roll the Instagram credential

**The token's data access expires 2026-11-17 — 68 days out.**

The token itself is a PAGE token and never expires, so nothing looks wrong until
the day it stops. When data access lapses, insights reads and publishing both
fail and **nothing announces it** — the account simply goes quiet, which is the
exact failure this project was automated to prevent.

This is the one thing here that cannot be automated away: re-authorization needs
a human at the Graph API Explorer.

To roll it:

1. Graph API Explorer → your app (**Bogey Golf**) → **Generate Access Token**.
2. Keep every scope currently on it, or insights will silently degrade:
   `instagram_basic`, `instagram_content_publish`, `instagram_manage_insights`,
   `pages_show_list`, `pages_read_engagement`, `business_management`.
3. Exchange for a long-lived token, then a page token.
4. Update it in **both** places — they are separate copies:
   - `.env` → `IG_ACCESS_TOKEN` (local CLI use)
   - GitHub → repo secret `IG_ACCESS_TOKEN` (the weekly report)
   - Secrets Manager `insta-golf/ig-token` (the poster Lambda — this is the one
     that actually publishes; miss it and posting stops even if stats work)
5. Confirm with `npm run stats` — it prints a warning inside 21 days of expiry.

The weekly report carries the countdown and starts warning at 21 days, so it
will nag from **2026-10-27**. Don't wait for that.

## Where things stand

The account posted 31 times (Aug 7 → Aug 31), then went dark for nine days when
the queue drained and nothing refilled it. That gap is what drove everything
below.

| | |
|---|---|
| Queue | **32 posts, Sep 10 → Oct 11**, all Reels, gapless |
| Mix | 28 tips + 4 jokes (Sep 17, Sep 25, Oct 2, Oct 9) |
| Cadence | one post daily at 12:00 UTC (~8am ET) |
| Failed entries | none |
| Refill | automatic — tops up whenever fewer than 7 remain |
| Report | emailed Mondays to hlarimer@gmail.com |

## What the numbers said

**Reels beat static posts 14:1.** Over the 30 days to Sep 9: Reels averaged 73.7
views across 24 posts, static feed posts 5.3 across 4. Carousels and image memes
are off by default in `stage-week`; `--allow-static` brings them back.

**Two posts a day split reach rather than adding it.** One a day averaged ~113
views/day (Aug 10–19); two a day averaged ~110 (Aug 24–31) for double the
production cost. Hence one a day.

**Jokes and tips perform identically** — 55.0 vs 54.4 avg views in the only
window where both ran. Humor is an editorial choice, not a reach lever.

**Engagement is the real problem.** 6 likes, 1 comment, 0 saves, 0 shares across
28 posts. Views without saves or shares give the algorithm nothing to push on.
Nothing since Aug 10 has beaten `your-first-move-down-is-your-arms` (137 views).

## Hands-off operation

`.github/workflows/keep-queue-full.yml`, two jobs, both verified working:

| Job | When | Does |
|---|---|---|
| `topup` | daily 06:00 UTC | tops the queue back to 14 if under 7, commits new scripts |
| `report` | Mondays 14:00 UTC | emails a week-over-week read written by Claude |

Daily and idempotent on purpose — a no-op six days in seven. A weekly refill
would still have allowed a nine-day gap.

AWS access is OIDC role assumption; no keys stored in GitHub. The role
`insta-golf-github-actions` is scoped to this bucket plus `ses:SendEmail` and is
denied on anything else.

Locally: `npm run ensure:queue -- --dry-run` and `npm run report -- --dry-run`.

## Repeat detection

The generator dedupes on **hooks**, which catches repeated wording and nothing
else. It never caught the failure that actually happens: the same tip rewritten.
The first 30-post batch came back 20% reruns, every one with a distinct hook.

`npm run dedupe` screens the whole script in two stages — a lexical pass
shortlists the closest existing scripts, then Claude judges only that shortlist.
Both stages are needed: the shortlist gets 100% recall at 5 and the judge caught
6 of 6 known duplicates, but no threshold can separate them, because real
duplicates score 0.22–0.57 while legitimate pairs reach 0.58.

Pointed at the live queue it found 9 duplicates in 30 posts, three of which a
careful hand review had missed. `stage-week` runs the same check between
generating and rendering, so the unattended path can't queue a rerun.

One flag is knowingly left standing: `lag-putt-to-a-bucket` resembles the Aug 7
post that got 4 views. Nobody saw the original.

## Known gaps

**Remotion has never rendered on a GitHub runner.** Both jobs pass, but `topup`
short-circuits while the queue is full, so the render path stays untested until
the queue crosses below 7 on **2026-10-05**. Worth forcing a real staging run
before then rather than discovering it that morning.

**A failed post leaves a silent hole.** The poster marks an entry `failed` and
moves on; `ensure-queue` reports failures but doesn't backfill the lost day.

**Content still clusters by topic.** Generating a month against one topic string
leans the queue toward whatever the model reaches for first. Give each week its
own `--topic` when staging by hand.

## Costs

Negligible: roughly 7 Claude generations plus ~$0.20 of fal.ai images per
top-up, one Claude call for the weekly read, and ~60 of GitHub's 2,000 free
Actions minutes a month.
