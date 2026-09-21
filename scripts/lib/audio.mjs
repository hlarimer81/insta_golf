/**
 * Background music beds for Reels.
 *
 * Instagram's own music library (trending audio) cannot be attached through the
 * Content Publishing API — that picker exists only in the native app. Anything
 * this pipeline publishes has to carry its audio baked into the MP4, which
 * means every track here must be cleared for commercial use on a business
 * account. See public/audio/README.md for where to get them.
 *
 * Tracks are assigned deterministically per slug: the same script always gets
 * the same bed, so re-generating or re-rendering never silently swaps it.
 *
 * Two ways to supply them, because public/audio/ is git-ignored and therefore
 * absent on a GitHub runner — the same reason b-roll is regenerated per run by
 * scripts/bg.mjs. A local file is fine for trying this out; the unattended path
 * needs URLs, which the renderer passes straight through (see resolveSrc in
 * src/BogeyReel.tsx):
 *
 *   BOGEY_AUDIO_TRACKS  comma- or newline-separated URLs — set this in CI
 *   public/audio/*.mp3  local files, used when that variable is unset
 */
import { readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const audioDir = join(root, "public", "audio");

const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|opus)$/i;

/** The cleared track pool: BOGEY_AUDIO_TRACKS if set, else public/audio/. */
export function availableTracks() {
  const fromEnv = (process.env.BOGEY_AUDIO_TRACKS ?? "")
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (fromEnv.length) return fromEnv;

  if (!existsSync(audioDir)) return [];
  return readdirSync(audioDir)
    .filter((f) => AUDIO_EXT.test(f))
    .sort()
    .map((f) => `audio/${f}`);
}

// Stable across runs and across machines — Math.random() would reshuffle beds
// on every regeneration, and a hash of the slug will not.
const hashOf = (s) => {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
};

/**
 * Pick a bed for a slug, or null when no tracks are installed. Null matters:
 * pointing audioSrc at a file that isn't there fails the render, and an
 * unattended render failure is exactly the silent gap this project exists to
 * avoid. Silent Reels are the safe default until real tracks are added.
 */
export function pickTrack(slug, tracks = availableTracks()) {
  if (!tracks.length) return null;
  return tracks[hashOf(slug) % tracks.length];
}
