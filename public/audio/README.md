# Background music beds

Drop commercially cleared instrumental tracks here. The generator assigns one
to each new script; existing scripts are left silent unless you set `audioSrc`
by hand.

## Why not trending audio

Instagram's music library — the trending-sound picker — **cannot be reached
through the Content Publishing API**. It exists only in the native app, so no
API-based tool can attach a track at publish time. Everything this pipeline
posts carries its audio baked into the MP4.

That makes the choice of track a licensing question, not a taste question. This
is a **business account**, which gets a deliberately narrower music catalog than
a creator account because most commercial use needs separate rights. Embedding a
popular commercial song risks territory-based muting, removal, rights-holder
takedowns and account feature restrictions — and a restriction on
`instagram_content_publish` would stop posting entirely, silently.

**So: nothing from the charts, nothing ripped from a Reel, nothing "probably
fine".** Only tracks with an explicit commercial license.

## Where to get cleared tracks

- **Meta Sound Collection** — free, pre-cleared for use on Meta platforms
- **Epidemic Sound**, **Artlist**, **Uppbeat** — subscription, commercial license

Pick instrumental beds. These Reels are text-on-screen with no voiceover, so
music is ambience, not the hook — anything with vocals competes with the copy.
The renderer mixes it at `volume={0.35}` (`src/BogeyReel.tsx`).

A tip Reel runs ~17–25s, so ~30s of usable track is plenty; playback starts at
the top of the file.

## Local files vs CI

`public/audio/*` is git-ignored (same as `public/broll/*`), so files here exist
only on your machine. B-roll gets away with that because `scripts/bg.mjs`
regenerates it on every run — music has no such step.

That matters because the unattended top-up renders **on a GitHub runner**, where
this folder is empty:

| Where | How to supply tracks |
|---|---|
| Local | Drop files here. Scripts get `audioSrc: "audio/<file>.mp3"`. |
| CI | Set `BOGEY_AUDIO_TRACKS` to comma-separated **URLs**. |

The renderer passes `http(s)` sources straight through (`resolveSrc` in
`src/BogeyReel.tsx`), so hosting the beds in the project's existing S3 bucket
and listing those URLs works in both places. `BOGEY_AUDIO_TRACKS` wins over
local files when both are present.

## Don't move a track a script already uses

`audioSrc` is written into the script JSON at generation time. Renaming or
deleting a track that queued scripts reference makes those renders **fail**, and
an unattended render failure is the silent gap this whole project exists to
prevent. Add new tracks freely; retire old ones only once nothing references
them.
