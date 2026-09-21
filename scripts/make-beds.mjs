#!/usr/bin/env node
/**
 * Synthesize the background music beds in public/audio/.
 *
 *   npm run beds            # write any missing beds
 *   npm run beds -- --force # rewrite them all
 *
 * These are original compositions generated here, not licensed recordings.
 * That is deliberate: Instagram's trending-audio library is unreachable
 * through the Content Publishing API, so a track has to be baked into the MP4,
 * and baked-in audio on a business account is a rights question. Music written
 * in this repo has no rights question -- the account owns it outright.
 *
 * It also means CI needs no track hosting: public/audio is git-ignored, and a
 * runner regenerates the beds the same way scripts/bg.mjs regenerates b-roll.
 * Output is deterministic, so every machine produces the same files.
 *
 * Deliberately plain music: these sit at volume 0.35 under text-on-screen
 * Reels with no voiceover, so the job is warmth, not attention.
 */
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const audioDir = join(root, "public", "audio");
const force = process.argv.includes("--force");

const RATE = 44100;
const BARS = 8; // 8 bars x 4 chords cycling = ~38s
const BAR_SECONDS = 4.8;

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

// Seeded, so a runner and a laptop produce identical files.
const rng = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

/**
 * Four beds, each a ii-V-I-ish loop that resolves. Voicings are deliberately
 * close and mid-register: wide low chords fight the voice-free copy on screen.
 */
const BEDS = [
  {
    name: "fairway-morning",
    seed: 11,
    // Am7 - Fmaj7 - Cmaj7 - G6
    chords: [[57, 64, 67, 71], [53, 60, 65, 69], [48, 60, 64, 67], [55, 62, 64, 71]],
    tone: 2400,
  },
  {
    name: "range-session",
    seed: 29,
    // Cmaj7 - Am7 - Fmaj7 - G7
    chords: [[48, 60, 64, 67], [57, 64, 67, 71], [53, 60, 65, 69], [55, 62, 65, 71]],
    tone: 2900,
  },
  {
    name: "back-nine",
    seed: 47,
    // Dm9 - Bbmaj7 - Fmaj7 - C
    chords: [[50, 62, 65, 72], [46, 58, 62, 65], [53, 60, 65, 69], [48, 60, 64, 67]],
    tone: 2100,
  },
  {
    name: "clubhouse",
    seed: 73,
    // Gmaj7 - Em7 - Cmaj7 - D
    chords: [[55, 62, 66, 71], [52, 59, 64, 67], [48, 60, 64, 67], [50, 62, 66, 69]],
    tone: 2600,
  },
];

/** One-pole low-pass. Takes the glassy edge off raw oscillators. */
const lowpass = (buf, cutoff) => {
  const a = 1 - Math.exp((-2 * Math.PI * cutoff) / RATE);
  let y = 0;
  for (let i = 0; i < buf.length; i++) buf[i] = y += a * (buf[i] - y);
};

/** Feedback delay, standing in for a room. Cheap, and enough at this volume. */
const delay = (buf, ms, feedback, mix) => {
  const d = Math.floor((ms / 1000) * RATE);
  for (let i = d; i < buf.length; i++) buf[i] += buf[i - d] * feedback * mix;
};

function renderBed(bed) {
  const rand = rng(bed.seed);
  const total = Math.floor(BARS * BAR_SECONDS * RATE);
  const left = new Float64Array(total);
  const right = new Float64Array(total);

  for (let bar = 0; bar < BARS; bar++) {
    const chord = bed.chords[bar % bed.chords.length];
    const start = Math.floor(bar * BAR_SECONDS * RATE);
    const len = Math.floor(BAR_SECONDS * RATE);

    // --- pad: slow swell, three detuned voices per note for movement --------
    for (const note of chord) {
      for (let v = 0; v < 3; v++) {
        const detune = (v - 1) * 0.12 + (rand() - 0.5) * 0.05;
        const f = midi(note) * Math.pow(2, detune / 1200);
        const pan = 0.5 + (v - 1) * 0.28;
        const phase = rand() * Math.PI * 2;
        for (let i = 0; i < len; i++) {
          const t = i / RATE;
          // long attack, long release: the chord breathes across the bar
          const env =
            Math.min(1, t / 1.1) * Math.min(1, (BAR_SECONDS - t) / 1.4) * 0.055;
          const s = Math.sin(2 * Math.PI * f * t + phase) * env;
          const j = start + i;
          if (j < total) {
            left[j] += s * (1 - pan);
            right[j] += s * pan;
          }
        }
      }
    }

    // --- arpeggio: soft plucks on the upper chord tones ---------------------
    const steps = 6;
    for (let s = 0; s < steps; s++) {
      const note = chord[(s + bar) % chord.length] + 12;
      const f = midi(note);
      const at = Math.floor(start + (s / steps) * len);
      const dur = Math.floor(RATE * 1.0);
      const pan = 0.35 + rand() * 0.3;
      for (let i = 0; i < dur; i++) {
        const t = i / RATE;
        const env = Math.exp(-t * 4.2) * 0.075;
        // triangle-ish: a sine plus a quiet third harmonic reads as plucked
        const s1 =
          (Math.sin(2 * Math.PI * f * t) + 0.18 * Math.sin(2 * Math.PI * f * 3 * t)) * env;
        const j = at + i;
        if (j < total) {
          left[j] += s1 * (1 - pan);
          right[j] += s1 * pan;
        }
      }
    }

    // --- sub: root an octave down, felt more than heard ---------------------
    const f = midi(chord[0] - 12);
    for (let i = 0; i < len; i++) {
      const t = i / RATE;
      const env = Math.min(1, t / 0.9) * Math.min(1, (BAR_SECONDS - t) / 1.0) * 0.05;
      const s = Math.sin(2 * Math.PI * f * t) * env;
      const j = start + i;
      if (j < total) {
        left[j] += s;
        right[j] += s;
      }
    }
  }

  lowpass(left, bed.tone);
  lowpass(right, bed.tone);
  delay(left, 331, 0.34, 0.5);
  delay(right, 389, 0.34, 0.5);

  // Fade the top and tail so a loop never clicks in or out.
  const fade = Math.floor(RATE * 1.6);
  for (let i = 0; i < fade; i++) {
    const g = i / fade;
    left[i] *= g;
    right[i] *= g;
    left[total - 1 - i] *= g;
    right[total - 1 - i] *= g;
  }

  // Normalize to -3 dBFS. The renderer mixes at 0.35 on top of this.
  let peak = 0;
  for (let i = 0; i < total; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  const gain = peak > 0 ? 0.707 / peak : 1;

  const pcm = Buffer.alloc(total * 4);
  for (let i = 0; i < total; i++) {
    // tanh rounds off any remaining peak instead of clipping it square
    pcm.writeInt16LE(Math.round(Math.tanh(left[i] * gain) * 32000), i * 4);
    pcm.writeInt16LE(Math.round(Math.tanh(right[i] * gain) * 32000), i * 4 + 2);
  }
  return pcm;
}

const wavOf = (pcm) => {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(2, 22);
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 4, 28);
  h.writeUInt16LE(4, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
};

mkdirSync(audioDir, { recursive: true });

let made = 0;
for (const bed of BEDS) {
  const mp3 = join(audioDir, `${bed.name}.mp3`);
  if (existsSync(mp3) && !force) {
    console.log(`•  ${bed.name}.mp3 already there`);
    continue;
  }
  const wav = join(audioDir, `${bed.name}.wav`);
  writeFileSync(wav, wavOf(renderBed(bed)));

  // Remotion ships ffmpeg, so this needs nothing else installed.
  const r = spawnSync(
    "npx",
    ["remotion", "ffmpeg", "-y", "-i", wav, "-codec:a", "libmp3lame", "-b:a", "128k", mp3],
    { cwd: root, stdio: "pipe", encoding: "utf8" },
  );
  if (r.status !== 0) {
    console.error(`✗  ${bed.name}: mp3 encode failed, keeping the wav`);
    console.error((r.stderr || "").split("\n").slice(-4).join("\n"));
    continue;
  }
  spawnSync("rm", ["-f", wav]);
  console.log(`♪  ${bed.name}.mp3`);
  made++;
}

console.log(`\n${made ? `Wrote ${made} bed(s) to public/audio/.` : "Nothing to do."}`);
