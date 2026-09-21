# insta-golf — status

_Last updated: 2026-09-21_

## ⚠️ Action required: roll the Instagram credential

**The token's data access expires 2026-11-17 — 56 days out.**

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

The account posted 31 times (Aug 7 → Aug 31), went dark for nine days when the
queue drained, resumed Sep 10 and has posted daily since.

| | |
|---|---|
| Published | 43 posts |
| Queue | **20 posts, Sep 22 → Oct 11**, all Reels, gapless |
| Mix | 17 tips + 3 jokes |
| Cadence | one post daily at 12:00 UTC (~8am ET) |
| Failed entries | none |
| Refill | automatic — tops up whenever fewer than 7 remain |
| Report | emailed Mondays to hlarimer@gmail.com |

## What the numbers said

**The nine-day gap cost about 70% of reach, and it took eight days to win
back.** Sep 10–16 averaged 22.9 views a post against an August Reels baseline of
77.2. Sep 17–21 averaged 77.6 — back to par. The recovery is understated by the
raw average, because views accumulate and the three strongest posts in the
window were the three *newest*: 113, 112 and 92 views at 0–2 days old, while the
5–11 day old posts had plateaued at 4–61.

**Reels beat static posts 14:1**, and the five worst August posts were exactly
the five static ones (2–9 views). Turning static off removed the entire bottom
of the distribution. Carousels and image memes stay off by default in
`stage-week`; `--allow-static` brings them back.

**Two posts a day split reach rather than adding it.** One a day averaged ~113
views/day (Aug 10–19); two a day averaged ~110 (Aug 24–31) for double the
production cost. Hence one a day.

**Jokes and tips perform identically** — 55.0 vs 54.4 avg views. Humor is an
editorial choice, not a reach lever.

**Engagement moved for the first time, from almost nothing.** Likes per 100
views went 0.34 → 1.64 across Sep 10–21, and Sep 10 logged the account's first
ever save. In absolute terms that is 9 likes, 1 save, 1 share and **still zero
comments** over 12 posts. The direction reversed; the magnitude is near zero.
This remains the real problem — views without saves or shares give the algorithm
nothing to push on.

## Hands-off operation

`.github/workflows/keep-queue-full.yml`, two jobs, both verified working:

| Job | When | Does |
|---|---|---|
| `topup` | daily 06:00 UTC | generates beds, tops the queue back to 14 if under 7, commits new scripts |
| `report` | Mondays 14:00 UTC | emails a week-over-week read written by Claude |

Daily and idempotent on purpose — a no-op six days in seven. A weekly refill
would still have allowed a nine-day gap.

AWS access is OIDC role assumption; no keys stored in GitHub. The role
`insta-golf-github-actions` is scoped to this bucket plus `ses:SendEmail` and is
denied on anything else.

Locally: `npm run ensure:queue -- --dry-run` and `npm run report -- --dry-run`.

## Captions and hashtags

Every caption ends with a house set plus tags specific to that post, specific
ones first. The specific tags come from the script's `hashtags` field where the
generator wrote one, and otherwise from keyword matching — **tips only**, since
a joke mentions golf nouns in passing rather than being about them, and a
confidently wrong niche tag is worse than none.

Broad tags like `#golf` are far too large for an account this size to surface
in. The specific ones are the only ones a search can plausibly reach, which is
the whole point of the change.

`npm run recaption` rebuilds captions on pending entries, because captions are
baked in at enqueue time and a change otherwise reaches nothing already
scheduled. Run against the live queue on Sep 21: 17 of 20 updated, the 3
untouched being jokes.

## Music

Reels were silent until Sep 21. They now carry one of four beds —
`fairway-morning`, `range-session`, `back-nine`, `clubhouse` — assigned by slug
hash so a re-render never swaps one.

The beds are **original compositions generated by `npm run beds`**, not licensed
recordings. That is deliberate: Instagram's trending-audio library is
unreachable through the Content Publishing API, so any track is baked into the
MP4, and baked-in audio on a business account is a rights question whose failure
mode is muting or a publish restriction that announces itself to nobody. Music
written here has no rights question — the account owns it.

Being generated also means CI needs no track hosting: output is deterministic
and `public/audio/*` is git-ignored, so the runner regenerates the beds exactly
as `scripts/bg.mjs` regenerates b-roll.

All 20 queued Reels were re-rendered and re-uploaded on Sep 21 to pick up their
beds. Audio is baked in at render time, so `npm run rerender` is the only way to
score something already queued; it is resumable and takes a couple of minutes a
Reel.

**There is no read on whether music helps yet.** Per-post variance is enormous
(August ranged 2–137 views on similar content), so separating a modest lift from
noise at one post a day takes weeks, not days. Treat an early result as noise.

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

`lag-putt-to-a-bucket`, the one flag knowingly left standing, posted Sep 12 and
took 61 views — the best of that week. The gamble cost nothing.

## Known gaps

**Remotion has never rendered on a GitHub runner.** Both jobs pass, but `topup`
short-circuits while the queue is full, so the render path stays untested until
the queue crosses below 7 on **2026-10-05**. The `npm run beds` step is on that
same cold path.

A dispatch with `job: topup` alone does **not** close this. With 20 posts
queued, `ensure-queue` is at or above its floor and exits before reaching a
render. It still proves `npm ci`, the Remotion browser download, the beds step
and OIDC role assumption on Ubuntu, which is worth having, but not the render.

To force a real one, dispatch with `min` above the number already queued —
`job: topup`, `min: 21`, `target: 22` stages two posts and runs the whole
generate → dedupe → b-roll → render → enqueue path on the runner. Those two are
real posts and stay in the queue, so the test costs nothing beyond the Actions
minutes. Keep `job` off `both`, which also sends a report email. The daily
schedule ignores `min`/`target` and stays at 7/14.

**A failed post leaves a silent hole.** The poster marks an entry `failed` and
moves on; `ensure-queue` reports failures but doesn't backfill the lost day. The
weekly report now at least names days with no post.

**Content still clusters by topic.** Generating a month against one topic string
leans the queue toward whatever the model reaches for first. Give each week its
own `--topic` when staging by hand.

**Engagement is still the unsolved one.** Nothing shipped so far targets saves,
shares or comments — hashtags widen who sees a post, music affects watch time at
best. Neither asks anyone to do anything.

## Costs

Negligible: roughly 7 Claude generations plus ~$0.20 of fal.ai images per
top-up, one Claude call for the weekly read, and ~60 of GitHub's 2,000 free
Actions minutes a month. The music beds are synthesized locally and cost
nothing.
