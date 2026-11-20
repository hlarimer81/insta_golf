/**
 * The golf babies: the recurring cast and the video prompt built from a sketch.
 *
 * The babies' looks are fixed here, not left to the model that writes the
 * sketches, so every clip describes them in the same words. A text-to-video
 * model still won't draw them identically twice, but identical wording gets
 * close enough to read as the same two characters.
 */
export const CAST = {
  Birdie:
    "a chubby one-year-old baby in a tiny white polo onesie and a pink golf visor, " +
    "very serious about golf, furrowed little brow",
  Mulligan:
    "a slightly bigger one-year-old baby in an argyle onesie and an oversized navy bucket hat " +
    "that keeps slipping over his eyes, wildly overconfident",
};

/** The text-to-video prompt for a sketch written by scripts/babies.mjs. */
export function videoPrompt(sketch) {
  // Dialogue goes in double quotes: that is what Seedance (and Veo) read as
  // speech to generate and lip-sync, rather than as scene description.
  const lines = sketch.dialogue.map((d) => `${d.speaker} says: "${d.line}"`).join(" ");
  // The model's fields don't reliably end in a period, and run-on sentences
  // blur where the sound cue ends and the next instruction begins.
  const sentence = (s) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);
  return [
    // Not shallow depth of field: the background has to stay readable as a tee
    // box, green or fairway, or the setting the sketch depends on is lost.
    "Photorealistic, vertical 9:16 handheld smartphone video, bright natural daylight on a",
    "lush golf course, background in focus enough to recognize the part of the course,",
    "one continuous shot with no cuts.",
    `Two babies: Birdie, ${CAST.Birdie}; and Mulligan, ${CAST.Mulligan}.`,
    `Setting: ${sentence(sketch.setting)}`,
    // Recurring video-model mistakes: greens floating at the babies' waist,
    // two cups in one shot, and the tee peg stuck in the cup. Video models
    // follow positive descriptions better than negations, so each rule says
    // what is true and then rules out the mistake.
    "Framing: full-body shot, the babies' feet and the grass they stand on always in frame.",
    "Course layout: the grass is flat, level ground directly under the babies' feet; the",
    "green, fairway and tee box are all at ground level, never raised to waist height.",
    "At most one golf hole appears anywhere in the video, never two.",
    "Golf tees are only ever pushed into the grass on the tee box, never in the hole.",
    `Action: ${sentence(sketch.action)}`,
    // Comic timing, beat by beat. Left to itself the video model rushes the
    // pause and cuts the reaction short, and those are where the laugh is.
    // Sketches written before 2026-11-20 have no timeline and skip this.
    ...(sketch.timeline?.length
      ? [
          `Timing, second by second: ${sketch.timeline
            .map((b) => `${b.from}-${b.to}s: ${sentence(b.what)}`)
            .join(" ")}`,
          "Play every pause at full length, and hold the final reaction until the very last frame.",
        ]
      : []),
    `Dialogue, spoken clearly in cute baby voices with accurate lip sync: ${lines}`,
    `Sound: ${sentence(sketch.sound)}`,
    "Lighthearted, wholesome comedy. The babies are safe, happy and unhurt throughout.",
    "No on-screen text, no captions, no subtitles, no logos, no watermarks.",
  ].join(" ");
}

/**
 * Babies Reels run in their own lane of the queue: their own afternoon slot,
 * their own top-up. Entries carry `lane: "babies"`; anything without a lane
 * is the main daily post. Counting or scheduling one lane must ignore the
 * other, or a long babies queue would look like a full main queue.
 */
/**
 * Two slapstick Reels for every talk Reel, continuing from the styles already
 * queued (oldest first). Since 2026-11-20: on the first ~18 babies posts the
 * falls were watched nearly to the end (7.4-9.5s of ~8.5s clips) and the talk
 * sketches lost viewers around 5s.
 */
export function nextStyles(history, n) {
  const seq = [...history];
  const out = [];
  for (let i = 0; i < n; i++) {
    const style = seq.at(-1) === "slapstick" && seq.at(-2) === "slapstick" ? "talk" : "slapstick";
    seq.push(style);
    out.push(style);
  }
  return out;
}

export const BABIES_LANE = "babies";
export const inBabiesLane = (entry) => entry.lane === BABIES_LANE;

/**
 * The video model babies clips render on unless BABIES_VIDEO_MODEL (or the
 * older FAL_VIDEO_MODEL) says otherwise. Omni Flash since 2026-11-20: about a
 * quarter of Seedance's price, and the owner judged the first three takes
 * clearly better.
 */
export const DEFAULT_VIDEO_MODEL = "gemini-omni-1.2-flash";

/**
 * UTC hours the poster Lambda fires (template.yaml: cron(0 13,21 * * ? *)).
 * It publishes one post per firing, oldest due first.
 */
export const POSTER_FIRINGS_UTC = [13, 21];

/**
 * Which firing will publish a post due at `when`: "YYYY-MM-DDTHH" of the
 * first firing at or after it. Two entries with the same key compete for one
 * firing, and the loser pushes everything after it back a slot.
 */
export function firingKey(when) {
  const t = new Date(when);
  for (let d = 0; d < 2; d++) {
    for (const h of POSTER_FIRINGS_UTC) {
      const f = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + d, h));
      if (f >= t) return f.toISOString().slice(0, 13);
    }
  }
}

/**
 * The first `count` open posting slots, earliest first, as Dates.
 *
 * A slot is open when nothing in the queue, in either lane, is due for the
 * firing that would publish it. Failed entries don't hold one: they will
 * never post. Gaps are filled: the morning slots after the last tip open up
 * before the end of the afternoon run already queued, and they are exactly
 * what has to be filled. Nothing is placed sooner than 12 hours out, so a
 * fresh render is never due at the very next firing.
 */
export function openSlots(entries, count, slotHours = [12, 20], now = Date.now()) {
  const taken = new Set(entries.filter((e) => e.status !== "failed").map((e) => firingKey(e.publishAt)));
  const floor = now + 12 * 3600 * 1000;
  const slots = [];
  for (let day = new Date(floor); slots.length < count; day = new Date(day.getTime() + 86400000)) {
    for (const h of slotHours) {
      const when = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h));
      const key = firingKey(when);
      if (when.getTime() < floor || taken.has(key)) continue;
      taken.add(key);
      slots.push(when);
      if (slots.length === count) break;
    }
  }
  return slots;
}
