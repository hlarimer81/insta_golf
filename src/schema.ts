import { z } from "zod";
import { BRAND, VIDEO } from "./brand";

/**
 * The shape of a single Reel "script". This is what the script generator
 * produces and what the renderer consumes — one JSON file per Reel.
 */
/**
 * Optional animated diagram shown with a beat. Aligned to `beats` by index
 * (null = no diagram for that beat). Extend the union with new `type`s as we
 * add diagram components.
 */
export const visualSchema = z
  .object({
    type: z.literal("weight"), // weight-distribution bar (lead vs trail foot)
    lead: z.number().default(60), // % of weight on the lead foot
  })
  .nullable();

export const reelSchema = z.object({
  // Internal label (also used for the output filename).
  slug: z.string().default("bogey-reel"),

  // The 0–1s hook frame. This is 90% of whether the Reel works.
  hook: z.string(),

  // Sequential on-screen text beats, timed to b-roll cuts.
  beats: z.array(z.string()).min(1),

  // Optional diagrams, one per beat (aligned by index; null = text only).
  visuals: z.array(visualSchema).default([]),

  // Sign-off frame. Defaults to the Bogey signature.
  signoff: z.string().default(BRAND.signoff),

  // Optional background footage (path under assets/broll or a URL).
  // If omitted, renders on the solid brand green.
  brollSrc: z.string().nullable().default(null),

  // Optional background audio (path under assets/audio or a URL).
  audioSrc: z.string().nullable().default(null),

  // Pacing overrides (seconds).
  hookSeconds: z.number().default(VIDEO.hookSeconds),
  secondsPerBeat: z.number().default(VIDEO.secondsPerBeat),
  signoffSeconds: z.number().default(VIDEO.signoffSeconds),
});

export type ReelProps = z.infer<typeof reelSchema>;

/** Total frames for a given script, derived from pacing + beat count. */
export const totalFrames = (p: ReelProps): number => {
  const secs =
    p.hookSeconds + p.beats.length * p.secondsPerBeat + p.signoffSeconds;
  return Math.ceil(secs * VIDEO.fps);
};
