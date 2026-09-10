# insta-golf 🧢

Automation for a faceless golf Instagram page fronted by **Bogey** — the
everyman caddie. Dry, honest, encouraging. **Text-on-screen only** (no face,
no voiceover), which is exactly what makes it automatable.

## What's here now

An end-to-end script-to-post pipeline for Bogey, with a human gate in the middle:

```
generate  →  drafts/  →  review  →  scripts/  →  render  →  out/*.mp4  →  schedule  →  Instagram
Bogey       awaiting    approve /  render       Remotion   finished       queue +      auto-posted
writes      review      reject     queue                   Reels          --live       Reels
```

- **Generator** — Claude writes Bogey-voice scripts (hook + beats) as drafts.
- **Review** — you approve or reject each draft before it can be rendered.
- **Renderer** — turns each approved script into a finished vertical MP4,
  styled with the Bogey brand kit, over optional b-roll and audio. Built on
  [Remotion](https://remotion.dev).
- **Scheduler** — queues approved+rendered Reels and auto-posts them to
  Instagram on a cadence (via the Graph API, with the video hosted on S3).

## Setup

```bash
npm install
```

## Usage

**Preview & tweak visually** (opens Remotion Studio in the browser):

```bash
npm run studio
```

**Render Reels to MP4:**

```bash
npm run render                                   # every scripts/*.json
npm run render scripts/stop-buying-a-new-driver.json   # just one
```

Output lands in `out/<slug>.mp4` (1080×1920, H.264 — Instagram-ready).

**Render a carousel** (a swipeable image post from the same script — cover →
one slide per beat → save/follow CTA):

```bash
npm run render:carousel -- your-chips-are-fat-because-you-scoop
```

Slides land in `out/carousels/<slug>/01.png …` (1080×1350, 4:5) in swipe order.

**Render a meme** (a single-image joke post — setup on top, punchline on the
bottom — from a `--kind joke` script):

```bash
npm run render:meme -- the-provisional-goes-straight
```

Lands in `out/memes/<slug>.png` (1080×1350, 4:5).

**Add an AI background** (fal.ai Flux → animated Ken-Burns b-roll behind the
text):

```bash
npm run bg -- your-chips-are-fat-because-you-scoop
npm run render -- scripts/your-chips-are-fat-because-you-scoop.json
```

`bg` saves the image to `public/broll/<slug>.png` and sets `brollSrc` on the
script automatically; the renderer pans/zooms it behind the dark scrim. Needs
`FAL_KEY` in `.env` (from [fal.ai](https://fal.ai); ~1–4¢/image). Pass
`--prompt "…"` to override the auto golf-scene prompt, or `--ratio 4:5` for a
carousel/meme-shaped image instead of the 9:16 Reel crop. The prompt is themed
to the script: a tip gets a clean cinematic course, a joke gets the situation
it's about.

## Scheduling & posting

Queue approved, rendered Reels and auto-post them to Instagram:

```bash
# Confirm your AWS/Instagram credentials work (prints the AWS account/identity,
# does a real S3 round-trip, validates the IG token — posts nothing)
npm run schedule -- check
```

```bash
# Plan a cadence: queue every approved Reel, one per day at 9am, from a start date
npm run schedule -- plan --per-day 1 --start 2026-08-10 --time 09:00

# Or queue one at a specific time
npm run schedule -- add your-chips-are-fat-because-you-scoop --at 2026-08-10T09:00

npm run schedule -- list          # see the queue and statuses

npm run schedule -- run           # DRY RUN — shows what's due, posts nothing
npm run schedule -- run --live    # actually posts everything due now
npm run schedule -- run --live --watch   # keep running, posting as items come due
```

`run` is **dry-run by default** — it never posts without `--live`. A Reel only
goes out once it's approved (in `scripts/`), rendered (in `out/`), due, and you
pass `--live`. The queue lives in `queue.json` (git-ignored).

At post time each Reel is uploaded to your S3 bucket, Instagram fetches it via a
short-lived presigned URL (the bucket stays private), and the caption is built
from the hook + beats + hashtags (override per-Reel with a `caption` field).

### One-time setup

Publishing needs a few credentials in `.env` (see `.env.example`):

1. **Instagram Business/Creator account** linked to a Facebook Page.
2. A **Meta app** with the Instagram Graph API. Put your app's `APP_ID` /
   `APP_SECRET` (App settings → Basic) in `.env`, generate a short-lived token
   in the [Graph API Explorer](https://developers.facebook.com/tools/explorer)
   (scopes: `instagram_basic`, `instagram_content_publish`, `pages_show_list`,
   `pages_read_engagement`, `business_management`, and `instagram_manage_insights`
   for analytics), then run **`npm run ig:setup`**
   — it exchanges the token and writes `IG_USER_ID` + a durable `IG_ACCESS_TOKEN`
   to `.env` for you.
3. An **S3 bucket** plus AWS credentials (`AWS_REGION`, `AWS_ACCESS_KEY_ID`,
   `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET`). The IAM user needs `s3:PutObject` /
   `s3:GetObject` on the bucket. The bucket can stay private.

## Cloud automation (daily poster)

Post automatically every day without your computer running. The heavy/human
parts (generate, render) stay local; only the **posting** runs in AWS:

```
LOCAL (occasional)                       AWS (daily, unattended)
generate → render → enqueue ─► S3 ◄─── EventBridge cron → Lambda (poster)
                                        queue.json + reels/*.mp4 → Graph API
```

**Stage a whole week in one command** — generates scripts, renders them
(Reels, carousels, and memes, interleaved), and enqueues them, auto-appending
after whatever's already scheduled:

```bash
npm run stage:week                                   # 7 posts, next open week
npm run stage:week -- --count 14 --backgrounds       # two weeks + AI backgrounds
npm run stage:week -- --count 7 --humor 0 --topic "putting"   # tips only
npm run stage:week -- --start 2026-09-01 --start-format carousel
```

By default **half the run is humor**, spread evenly through it: tips alternate
Reel ↔ carousel, jokes alternate joke Reel ↔ meme, and day 1 is a tip. So a
14-day run comes out as 4 tip Reels, 3 carousels, 4 joke Reels, and 3 memes.
Use `--humor N` to change the split (`--humor 0` for tips only) and
`--humor-topic "…"` to steer the jokes.

This is the one-step way to top up. Animated diagrams are added automatically by
the generator when a beat is about weight/ball position; `--backgrounds` also
generates a themed fal.ai background per post — 9:16 for Reels, 4:5 for
carousels and memes (needs `FAL_KEY`). The commands below are the manual /
granular equivalents.

**Fill the cloud queue** (uploads the MP4 to S3 + appends to the queue, caption
baked in):

```bash
npm run enqueue -- your-chips-are-fat-because-you-scoop --at 2026-08-10T09:00
```

For a **carousel**, render the slides first, then enqueue with `--carousel`:

```bash
npm run render:carousel -- your-chips-are-fat-because-you-scoop
npm run enqueue -- your-chips-are-fat-because-you-scoop --at 2026-08-10T09:00 --carousel
```

For a **meme**, render the image first, then enqueue with `--meme`:

```bash
npm run render:meme -- the-provisional-goes-straight
npm run enqueue -- the-provisional-goes-straight --at 2026-08-10T09:00 --meme
```

The daily poster handles all three — Reels post as a video, carousels as a
multi-image post, memes as a single image. (After changing the poster, redeploy
with `npm run build:lambda && sam deploy --profile deployer`.)

**Check the queue** (⏳ pending / ✅ published / ❌ failed):

```bash
npm run enqueue -- list
```

**Check performance** — pulls likes/comments/reach/views/saves/shares for every
posted Reel from the Graph API:

```bash
npm run stats
```

Reach/views/saves/shares need the `instagram_manage_insights` permission on your
token (likes/comments work without it). If they come back blank, `stats` tells
you to regenerate the token with that scope and re-run `npm run ig:setup`.

**Deploy the daily poster** (one time), with [AWS SAM](https://docs.aws.amazon.com/serverless-application-model/):

```bash
# 1. Store the IG token in Secrets Manager. Easiest via the console (Store a new
#    secret → Other → Plaintext → paste the token). Or from the terminal,
#    reading it out of .env without touching shell history:
TOKEN_FILE="$(mktemp)"
printf '%s' "$(grep '^IG_ACCESS_TOKEN=' .env | cut -d= -f2-)" > "$TOKEN_FILE"
aws secretsmanager create-secret --name insta-golf/ig-token --secret-string "file://$TOKEN_FILE"
rm -f "$TOKEN_FILE"
# Note the returned secret ARN — that's IgTokenSecretArn below.

# 2. Bundle the Lambda and deploy
npm run build:lambda
sam deploy --guided \
  --template-file template.yaml \
  --stack-name insta-golf-poster
# When prompted, pass: BucketName, IgUserId, IgTokenSecretArn, ScheduleExpression
```

The Lambda runs on the schedule (default `cron(0 14 * * ? *)` = 14:00 UTC daily),
posts the next due Reel from `queue.json`, and writes status back. No rendering
and no local files are involved — just S3 + the Graph API.

> ⚠️ This posts with **no human review** — whatever you enqueue goes live on the
> schedule. Eyeball Reels before enqueuing, or add a review step back in.

## Hands-off operation (GitHub Actions)

`.github/workflows/keep-queue-full.yml` runs the account without you touching it.

| Job | When | What it does |
|---|---|---|
| `topup` | daily, 06:00 UTC | If fewer than 7 posts remain queued, stages enough to reach 14 and commits the new scripts back |
| `report` | Mondays, 14:00 UTC | Emails a week-over-week read of performance, written by Claude |

Both are also runnable by hand from the Actions tab (**Run workflow**).

The top-up is deliberately **daily and idempotent** — it's a no-op six days out
of seven. The queue drained on 2026-08-31 and the account sat dark for nine days;
a weekly refill would still have left a gap that big possible.

You can check the same thing locally at any time:

```bash
npm run ensure:queue -- --dry-run   # how much runway is left?
npm run report -- --dry-run         # what would this week's email say?
```

### One-time setup

AWS access uses **OIDC role assumption** — no AWS keys are stored in GitHub. The
role `insta-golf-github-actions` is scoped to this one bucket plus SES; it can't
touch anything else in the account.

Set these in the repo (Settings → Secrets and variables → Actions):

| Kind | Name | Value |
|---|---|---|
| Secret | `ANTHROPIC_API_KEY` | script generation + the weekly read |
| Secret | `FAL_KEY` | AI backgrounds |
| Secret | `IG_ACCESS_TOKEN` | reading insights |
| Variable | `REPORT_FROM` | a **verified** SES identity |
| Variable | `REPORT_TO` | where the report goes |

SES is in sandbox mode, so both addresses must be verified identities. Add one
with `aws ses verify-email-identity --email-address you@example.com`, then click
the link that arrives.

> ⚠️ **The access token's data access expires 60 days after authorization** —
> currently 2026-11-17. When it lapses, insights reads and posting both stop, and
> nothing will tell you except the account going quiet. The weekly report carries
> a countdown and starts warning at 21 days out; re-authorize before then.

## Generating scripts

Let Bogey write the scripts for you. This calls Claude and drops finished
`scripts/*.json` files, ready to render.

```bash
npm run generate                          # 5 scripts, general golf tips
npm run generate -- "fixing a slice"      # 5 scripts on a topic
npm run generate -- --count 8 "putting"   # 8 scripts on a topic
npm run generate -- --kind joke "bunkers" # 5 golf jokes instead of tips
```

`--kind joke` writes humor instead of coaching: a setup (`hook`), 2–3 escalating
`beats`, and a `punchline`. One joke script feeds two formats — a joke Reel
(setup → beats → punchline, held long) and a single-image meme (setup →
punchline only), so both lines have to land on their own.

It reads existing scripts and won't repeat their hooks, and never overwrites a
file (colliding slugs become `slug-2`, `slug-3`, …).

New scripts land in `scripts/drafts/` — they aren't render-eligible until you
approve them (see below).

Needs an Anthropic API key from [console.anthropic.com](https://console.anthropic.com).
Put it in a git-ignored `.env` in the project root:

```bash
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env
```

## Reviewing scripts

Vet a batch of drafts before anything gets rendered:

```bash
npm run review
```

For each draft it shows the hook and beats, then waits for you:

- **`a`** approve → moves it to `scripts/` (now render-eligible)
- **`r`** reject → moves it to `scripts/rejected/` (kept for reference)
- **`s`** skip → leaves it in `scripts/drafts/` for later
- **`q`** quit → stop; undecided drafts stay put

The renderer only reads top-level `scripts/*.json`, so nothing reaches `out/`
until you've approved it here.

## Writing a script

Prefer to write one by hand? One JSON file per Reel in `scripts/`. Minimal example:

```json
{
  "slug": "fix-your-slice",
  "hook": "The 10-second slice fix.",
  "beats": ["Strengthen your grip.", "See 2 knuckles.", "That's it."]
}
```

Optional fields: `kind` (`"tip"`, the default, or `"joke"`), `punchline` (the
payoff line on a joke — held after the beats in a Reel, and the bottom line of a
meme), `signoff` (defaults to the Bogey signature), `brollSrc` and `audioSrc` (a
URL, or a path under `public/broll` / `public/audio`), and pacing overrides
`hookSeconds` / `secondsPerBeat` / `punchSeconds` / `signoffSeconds`. Full shape
and defaults live in `src/schema.ts`.

Default pacing is deliberately unhurried — 3s on the hook, 3s per beat, 4s on a
punchline, 2.5s on the sign-off — so every card is readable without pausing. A
4-beat tip Reel runs ~17.5s. Change it once in `VIDEO` in `src/brand.ts`; it
applies to everything rendered afterwards (already-rendered MP4s keep their old
pacing).

## Brand kit

Colors, fonts, and the sign-off line live in `src/brand.ts` — change them there
and every Reel restyles.

## Roadmap

- [x] Reel renderer (script → MP4)
- [x] Script generator (batch Bogey-voice hooks/beats/captions)
- [x] Review workflow (approve a batch before posting)
- [x] Scheduler / auto-post (Instagram Graph API — needs a Business account)
- [x] Analytics pull (what's landing)
