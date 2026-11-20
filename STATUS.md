# insta-golf — status

_Last updated: 2026-11-20_

## The Instagram credential: next roll by 2027-02-18

**Rolled 2026-11-20. Data access now expires 2027-02-18**; the weekly report
starts warning on **2027-01-28**. Roll it then, don't wait for the date.

The token itself is a PAGE token and never expires, so nothing looks wrong until
the day it stops. When data access lapses, insights reads and publishing are
expected to fail and **nothing announces it**. In practice the old token was
still reading and posting three days past its 2026-11-17 date, which shows
Meta enforces this loosely, not that it never will.

This is the one thing here that cannot be automated away: re-authorization needs
a human at the Graph API Explorer. `APP_ID` and `APP_SECRET` are now in the
local `.env`, so the exchange runs from this machine.

To roll it:

1. Graph API Explorer → your app (**Bogey Golf**) → **User Token** →
   **Generate Access Token**, with every scope, or insights will silently
   degrade: `instagram_basic`, `instagram_content_publish`,
   `instagram_manage_insights`, `pages_show_list`, `pages_read_engagement`,
   `business_management`. In the login popup, "Continue as…" keeps the Page
   and Instagram account selected last time; **never untick them** under
   "Edit previous settings", which revokes the app's access to them for every
   token, old ones included.
2. Exchange it for a page token, written to `.env`. `ig:setup` prompts on
   stdin, which a Claude Code `!` command can't answer, so either run it in a
   real terminal or feed it from a file:
   `nano .ig-token` (paste) then `npm run ig:setup < .ig-token; rm -f .ig-token`.
3. **Check the result before copying it anywhere.** Paste a token issued
   earlier and the exchange succeeds anyway but hands back the old expiry; that
   happened on the first try on 2026-11-20. Run `npm run stats`, or ask Claude
   to debug_token the `.env` token, and confirm data access is ~90 days out.
4. Copy `IG_ACCESS_TOKEN` from `.env` into the two cloud copies, by hand
   (the local GitHub PAT can't write secrets and there's no AWS CLI here):
   - GitHub → repo secret `IG_ACCESS_TOKEN` (followers + the weekly report)
   - Secrets Manager `insta-golf/ig-token`, us-east-1, keeping its existing
     format (the poster Lambda — this is the one that actually publishes; miss
     it and posting stops even if stats work)
5. Confirm the GitHub copy by dispatching `topup` with `min: 0` (records
   followers, stages nothing), and the Lambda copy by the next post going out.

## Where things stand

The account posted 31 times (Aug 7 → Aug 31), went dark for nine days when the
queue drained, resumed Sep 10 and has posted daily since.

| | |
|---|---|
| Published | 43 posts |
| Queue | **21 posts, Sep 22 → Oct 12**, all Reels, gapless |
| Mix | 17 tips + 4 jokes |
| Cadence | one post daily at 12:00 UTC (~8am ET) |
| Failed entries | none |
| Refill | automatic — tops up whenever fewer than 7 remain |
| Report | Mondays, as a GitHub issue (GitHub emails it) |

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
| `topup` | daily 06:00 UTC | records the follower count, generates beds, tops the queue back to 14 if under 7, commits new scripts |
| `report` | Mondays 14:00 UTC | opens an issue with a week-over-week read written by Claude |

Daily and idempotent on purpose — a no-op six days in seven. A weekly refill
would still have allowed a nine-day gap.

AWS access is OIDC role assumption; no keys stored in GitHub. The role
`insta-golf-github-actions` is scoped to this bucket plus `ses:SendEmail` and is
denied on anything else.

Locally: `npm run ensure:queue -- --dry-run` and `npm run report -- --dry-run`.

## Followers

**Added 2026-10-16. Nothing measured followers before this**, so there is no
follower history before that date and none can be recovered: Instagram serves
no history to accounts under 100 followers, and only 30 days above that.

The top-up job snapshots the count daily into `followers.json` in the bucket
(`npm run followers` does it by hand). `npm run stats` and the weekly report
read growth off those snapshots, plus followers per 1k views — the number that
says whether views are turning into an audience. Growth becomes readable a week
after the first snapshot.

## Format change: short Reels that ask for something (2026-10-17)

About 80 posts had earned 5 followers, and Reels were stalling at 50–75 views,
about the size of the small test audience Instagram first shows a Reel to. They
were not getting past it because nothing told Instagram to push them further:
saves, shares and comments were all at or near zero.

- **Shorter.** Tips are now hook + exactly 3 beats at 2.2s, about 10s total
  (were 3s cards, 5–6 beats, ~24s). Jokes have 1–2 beats. Watch-through is what
  Reels rank on.
- **An ask.** The end card is now "Save this for your next round." on tips and
  "Send this to the guy who does this." on jokes. Captions carry the same ask,
  and jokes ask for a tag, which is a comment.
- **Hooks** lean toward contradicting common advice. The one data point:
  "Stop trying to keep your head down." took 116 views against 9 for a
  situation hook. That is one pair, a hunch to test, not a finding.

Both changes went in together on purpose: at 5 followers the account needs a
large improvement more than a clean attribution. **The 10 posts already queued
(through Oct 26) are in the old format** until re-rendered (`npm run rerender`,
plus `npm run recaption` for captions); new scripts are staged in the new
format. Judge it in the reports from the second week of November.

**The report now compares settled posts.** Views keep climbing for about a week
after posting, so comparing the latest week with the one before always showed a
decline. The Oct 16 report called that "a real decline" when the newest posts
were hours old. Views are now compared between posts 7–13 and 14–20 days old;
the latest week is reported only as "so far".

## Golf babies: the whole account from 2026-12-02

AI video Reels of two babies, Birdie and Mulligan, doing golf comedy. Started
2026-10-28 as a second, afternoon post beside the morning tip. **Tips were
retired on 2026-11-20**: the ones already queued post out (the last is due
Dec 1), nothing restocks them, and from Dec 2 both daily posts are babies
Reels, due 12:00 and 20:00 UTC (the 13:00 and 21:00 firings: 8am and 4pm
Eastern in winter). Styles alternate: slapstick (a fall, the hat over the eyes,
then a one-word tag) and talk (a golf-guy brag undercut by being a baby).

- **Slots, not days.** `stage:babies` puts each Reel in the earliest open
  12:00 or 20:00 slot, a slot being taken when anything in either lane is due
  for that firing. So babies take the mornings exactly as the tips run out,
  and fill any morning a failed or missing tip left open.
- **Own lane, now the live one.** Queue entries carry `lane: "babies"`. The
  `babies` job tops it up to 20 when under 10 (10 days / 5 days at two a
  day). `ensure:queue` on the main lane only reports; it stages tips again
  only with `--allow-tips`, and the `topup` job now just records followers.
- **No review gate.** Claude writes 12 sketches per style, a second call judges
  them, the best go straight to video and the queue. The owner reviews them on
  Instagram and tunes the prompts in `scripts/babies.mjs`.
- **Rendered on Gemini Omni Flash (720p) since 2026-11-20**, was Seedance 2.0
  on fal.ai. Three trial takes of already-posted sketches were judged clearly
  better by the owner, and each rendered in under a minute against several on
  fal.ai. Set the repo variable `BABIES_VIDEO_MODEL` to a fal.ai model to go
  back; nothing else changes.
- **Cost: ~$0.07 per second, ~$0.60 a clip, ~$36 a month at two a day** (was
  ~$0.30/s and ~$80 a month at one a day on Seedance). The per-second rate is
  derived from Google's per-token price, so check it against the first bill.
  A failed render is skipped, not retried, and turns the job red.
- **This goes against the August finding** that a second daily post split
  reach rather than adding to it. That was two of the same format; this is a
  different one, by the owner's choice. Watch whether the morning posts lose
  views once it starts.
- **A missed 13:00 firing now shifts both lanes by one slot.** The 21:00
  firing used to be a spare; now it has its own post. Miss a morning and the
  poster (one post per firing, oldest first) runs one slot behind until a
  firing finds nothing due — which, at two posts a day and two firings, is
  never. Raising `MAX_POSTS_PER_RUN` to 2 would fix it, at the cost of a
  redeploy.

## Weekly report delivery

The report was emailed through SES from hlarimer@gmail.com to itself, and **none
ever arrived**, though SES accepted every one. Mail claiming a gmail.com sender
that did not come from Google is what Gmail discards as spoofed. Since
2026-10-16 the report is opened as a GitHub issue that @mentions the owner, so
GitHub sends the email. SES is still tried, best effort. A Claude failure now
costs only the written read, not the whole report (on Oct 12 the API spend cap
cost the whole thing).

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

**~~Remotion has never rendered on a GitHub runner.~~ Closed 2026-09-21.** A
dispatch with `min: 21, target: 21` staged one post and ran the whole path on
Ubuntu — generate → dedupe → fal.ai b-roll → render → S3 upload → enqueue —
producing `you-fixed-your-swing-on-youtube` for Oct 12. The rendered file was
pulled back from S3 and checked: 1080x1920, 30fps, h264 + AAC. `npm run beds`
ran there too and the `libmp3lame` encode worked, so the script got
`audio/range-session.mp3` rather than the `.wav` fallback. `BOGEY_AUDIO_TRACKS`
was empty, confirming the generated beds are found without hosted URLs.

The dispatch inputs stay useful: `min` above the number already queued forces a
real render whenever the path needs re-proving, and the daily schedule ignores
them at 7/14. Keep `job` on `topup` — `both` also sends a report email.
_(Since 2026-11-20 `topup` stages nothing — tips are retired — so a render
re-proof now means dispatching `babies` with `min` above the queued count.)_

**A failed post leaves a silent hole.** The poster marks an entry `failed` and
moves on; `ensure-queue` reports failures but doesn't backfill the lost day. The
weekly report now at least names days with no post.

**Content still clusters by topic.** Generating a month against one topic string
leans the queue toward whatever the model reaches for first. Give each week its
own `--topic` when staging by hand.

**Engagement is still the unsolved one.** Nothing shipped so far targets saves,
shares or comments — hashtags widen who sees a post, music affects watch time at
best. Neither asks anyone to do anything.

## Keeping the automation current

Action versions are pinned to the **lowest** major that runs on Node 24, not the
newest: Node 20 deprecation on runners is the only reason to move, and every
further major carries breaking changes this pipeline gains nothing from.
`checkout` and `setup-node` reached Node 24 at v5; `configure-aws-credentials`
only at v6, since its v5 is still Node 20. Verified against each action's
`action.yml` rather than its release notes.

When GitHub next deprecates a runtime, check `using:` on the action rather than
trusting the release title — that is the field the runner actually reads.

## Costs

The babies videos (~$36 a month, above) are the only real cost. Otherwise
negligible: Claude sketch-writing on each babies top-up, one Claude call for the weekly read, and ~60 of GitHub's 2,000 free
Actions minutes a month. The music beds are synthesized locally and cost
nothing.
