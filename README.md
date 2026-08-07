# insta-golf 🧢

Automation for a faceless golf Instagram page fronted by **Bogey** — the
everyman caddie. Dry, honest, encouraging. **Text-on-screen only** (no face,
no voiceover), which is exactly what makes it automatable.

## What's here now

**The Reel renderer** — turns a Bogey *script* (a hook + beats + sign-off) into
a finished vertical MP4, styled with the Bogey brand kit, over optional b-roll
and audio. Built on [Remotion](https://remotion.dev).

```
scripts/*.json   →   [Remotion: BogeyReel]   →   out/<slug>.mp4
 (one per Reel)        text-on-screen render      ready to post
```

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

## Writing a script

One JSON file per Reel in `scripts/`. Minimal example:

```json
{
  "slug": "fix-your-slice",
  "hook": "The 10-second slice fix.",
  "beats": ["Strengthen your grip.", "See 2 knuckles.", "That's it."]
}
```

Optional fields: `signoff` (defaults to the Bogey signature), `brollSrc` and
`audioSrc` (a URL, or a path under `public/broll` / `public/audio`), and pacing
overrides `hookSeconds` / `secondsPerBeat` / `signoffSeconds`. Full shape and
defaults live in `src/schema.ts`.

## Brand kit

Colors, fonts, and the sign-off line live in `src/brand.ts` — change them there
and every Reel restyles.

## Roadmap

- [x] Reel renderer (script → MP4)
- [ ] Script generator (batch Bogey-voice hooks/beats/captions)
- [ ] Review workflow (approve a batch before posting)
- [ ] Scheduler / auto-post (Instagram Graph API — needs a Business account)
- [ ] Analytics pull (what's landing)
