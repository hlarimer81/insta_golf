import React from "react";
import {
  AbsoluteFill,
  interpolate,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Background, Wordmark } from "./BogeyReel";
import { BRAND, VIDEO } from "./brand";
import type { ReelProps } from "./schema";

/**
 * The meme, as a Reel (1080×1920). Same setup → punchline joke as the image
 * meme, but delivered as video: the setup holds, then the punchline drops in
 * over a slow push on the background.
 *
 * Why this exists: on a young account, static feed posts reach a tiny fraction
 * of what Reels reach, so a meme posted as an image barely gets seen. Same
 * joke, Reel distribution.
 *
 * Duration = setupSeconds + punchSeconds (see memeReelFrames).
 */

const SETUP_SECONDS = 3;

export const memeReelFrames = (p: ReelProps): number =>
  Math.ceil((SETUP_SECONDS + p.punchSeconds) * VIDEO.fps);

/** Setup line, top third — on screen for the whole cut. */
const Setup: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 14 });

  return (
    <div
      style={{
        transform: `translateY(${interpolate(enter, [0, 1], [30, 0])}px)`,
        opacity: interpolate(enter, [0, 1], [0, 1]),
        fontFamily: BRAND.fonts.display,
        fontWeight: 900,
        fontSize: 84,
        lineHeight: 1.1,
        color: BRAND.colors.cream,
        textAlign: "center",
        textShadow: "0 4px 24px rgba(0,0,0,0.65)",
      }}
    >
      {text}
    </div>
  );
};

/** Punchline, lower third — pops in with a bounce once the setup has landed. */
const Punch: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 11, mass: 0.6 }, durationInFrames: 26 });

  return (
    <div
      style={{
        transform: `scale(${interpolate(pop, [0, 1], [0.7, 1])}) rotate(${interpolate(
          pop,
          [0, 1],
          [-3, 0],
        )}deg)`,
      }}
    >
      <div
        style={{
          padding: "44px 50px",
          borderRadius: 36,
          backgroundColor: "rgba(8,38,29,0.78)",
          boxShadow: "0 18px 60px rgba(0,0,0,0.45)",
        }}
      >
        <div
          style={{
            fontFamily: BRAND.fonts.display,
            fontWeight: 900,
            fontSize: 88,
            lineHeight: 1.06,
            color: BRAND.colors.accent,
            textAlign: "center",
            textShadow: "0 6px 28px rgba(0,0,0,0.65)",
          }}
        >
          {text}
        </div>
      </div>
    </div>
  );
};

export const MemeReel: React.FC<ReelProps> = ({ hook, punchline, beats, brollSrc }) => {
  const { fps } = useVideoConfig();
  const payoff = punchline ?? beats[beats.length - 1] ?? "";

  return (
    <AbsoluteFill>
      <Background brollSrc={brollSrc} />
      <Wordmark />
      <AbsoluteFill
        style={{
          padding: "300px 80px 320px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Setup text={hook} />
        <Sequence from={Math.round(SETUP_SECONDS * fps)} layout="none">
          <Punch text={payoff} />
        </Sequence>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
