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
    `Action: ${sentence(sketch.action)}`,
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
export const BABIES_LANE = "babies";
export const inBabiesLane = (entry) => entry.lane === BABIES_LANE;
