# insta-golf — status

_Last updated: 2026-09-09_

## Where things stand

The account posted **31 times (Aug 7 → Aug 31)**, then went **dark for 9 days** —
the queue drained on Aug 31 and nothing refilled it. The cron kept firing into an
empty queue the whole time.

Refilled today: **30 posts, Sep 10 → Oct 9, one per day, all Reels.**

## Last 30 days (Aug 10 – Sep 9)

| Format | Posts | Views | Avg | Reach |
|---|---|---|---|---|
| Reels | 24 | 1,768 | **73.7** | 1,599 |
| Static (`/p/`) | 4 | 21 | **5.3** | 10 |

Engagement across all 28: **6 likes, 1 comment, 0 saves, 0 shares.**
Top performer is still `your-first-move-down-is-your-arms` (137, Aug 10) — nothing
in the last four weeks has beaten it.

## The finding that drove today's changes

**Two posts a day did not add reach — it split it.**

| Cadence | Period | Views/post | Views/day |
|---|---|---|---|
| 1/day | Aug 10–19 | 112.8 | ~113 |
| 2/day | Aug 24–31 | ~55 | ~110 |

Same daily total, double the production cost. Back to one a day.

**Jokes and tips perform identically.** In the only window where both ran:

| | Posts | Views | Avg | Likes |
|---|---|---|---|---|
| Jokes | 8 | 440 | 55.0 | 3 |
| Tips | 7 | 381 | 54.4 | 2 |

So cutting humor was never a performance question. Kept at ~1/week for variety.

## What's live now

| | |
|---|---|
| Cron | `cron(0 13,21 * * ? *)` — unchanged, see note below |
| Posts per firing | 1 (`MAX_POSTS_PER_RUN`) |
| Queue | 30 posts, Sep 10 → Oct 9, **all Reels**, 26 tips + 4 jokes |
| Cadence | one post daily at 12:00 UTC (~8am ET), picked up by the 13:00 firing |

**The cron stays twice-daily on purpose.** The poster only takes entries with
`publishAt <= now` and `status === "pending"`, so the 21:00 firing can never pull
the next day's post early. It costs one no-op invocation a day and covers the case
where the 13:00 invocation never runs. One-a-day is enforced by the queue holding
one entry per day, not by the schedule.

## Changed today

1. **`stage-week.mjs` now stages Reels only.** It was still alternating tips
   reel ↔ carousel and jokes Reel ↔ image meme — the Aug 23 "carousels are dead"
   decision never reached the tool. A plain `--count 30` would have staged 13
   carousels and 2 static memes onto the format averaging 5 views. The old
   behavior is behind `--allow-static`.
2. **`stage-week.mjs` won't schedule into the past.** Its default start is "the
   day after the last queued post"; with the queue 9 days stale that was Sep 1,
   so every post would have been due at once. Now clamped to tomorrow.
3. **Replaced 6 generated scripts that repeated existing content.** The generator
   only sees prior *hooks* for dedupe, and gets the same broad topic string on
   every chunk, so it converges: three near-identical "pick a landing spot" chip
   scripts, two identical "punch out of the trees," one restatement of the Aug 8
   flag-aiming post, one restatement of the Aug 9 fat-chip post, and a third
   airing of "take one more club and swing easy."

## Known weakness

Generating a month on one topic string produces topic clusters. The 30 queued
posts still lean putting-heavy (6 of 26 tips). If this is repeated, give each
week its own `--topic` rather than reusing the default.
