import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { BRAND } from "./brand";
import type { ReelProps } from "./schema";

/**
 * A swipeable carousel built from the same script the Reel uses:
 *   slide 1        cover (the hook)
 *   slides 2..N-1  one per beat
 *   slide N        sign-off + save/follow CTA
 *
 * Portrait 4:5 (1080×1350). Each FRAME is one slide, so a still render at
 * --frame=N produces slide N. Total slides = beats.length + 2.
 */

export const carouselSlideCount = (beats: string[]): number => beats.length + 2;

const PAD = 96;

const Wordmark: React.FC = () => (
  <div
    style={{
      position: "absolute",
      top: 64,
      left: PAD,
      fontFamily: BRAND.fonts.body,
      fontWeight: 800,
      fontSize: 36,
      letterSpacing: 4,
      color: BRAND.colors.cream,
      opacity: 0.85,
    }}
  >
    BOGEY
  </div>
);

const Slide: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AbsoluteFill
    style={{
      backgroundColor: BRAND.colors.green,
      justifyContent: "center",
      alignItems: "center",
      padding: `0 ${PAD}px`,
      textAlign: "center",
    }}
  >
    <Wordmark />
    {children}
  </AbsoluteFill>
);

const Cover: React.FC<{ hook: string }> = ({ hook }) => (
  <Slide>
    <div
      style={{
        fontFamily: BRAND.fonts.display,
        fontWeight: 900,
        fontSize: 104,
        lineHeight: 1.08,
        color: BRAND.colors.cream,
        textShadow: "0 4px 24px rgba(0,0,0,0.5)",
      }}
    >
      {hook}
    </div>
    <div
      style={{
        height: 12,
        width: 220,
        backgroundColor: BRAND.colors.accent,
        borderRadius: 999,
        margin: "40px 0",
      }}
    />
    <div
      style={{
        position: "absolute",
        bottom: 70,
        fontFamily: BRAND.fonts.body,
        fontWeight: 800,
        fontSize: 34,
        letterSpacing: 6,
        color: BRAND.colors.accent,
      }}
    >
      SWIPE →
    </div>
  </Slide>
);

const Beat: React.FC<{ text: string; index: number; total: number }> = ({
  text,
  index,
  total,
}) => (
  <Slide>
    <div
      style={{
        position: "absolute",
        top: 64,
        right: PAD,
        fontFamily: BRAND.fonts.body,
        fontWeight: 800,
        fontSize: 34,
        letterSpacing: 2,
        color: BRAND.colors.accent,
      }}
    >
      {index + 1} / {total}
    </div>
    <div
      style={{
        fontFamily: BRAND.fonts.display,
        fontWeight: 900,
        fontSize: 78,
        lineHeight: 1.14,
        color: BRAND.colors.cream,
        textShadow: "0 4px 20px rgba(0,0,0,0.45)",
      }}
    >
      {text}
    </div>
  </Slide>
);

const CTA: React.FC<{ signoff: string }> = ({ signoff }) => (
  <Slide>
    <div
      style={{
        fontFamily: BRAND.fonts.display,
        fontWeight: 900,
        fontSize: 64,
        lineHeight: 1.16,
        color: BRAND.colors.cream,
      }}
    >
      {signoff}
    </div>
    <div
      style={{
        height: 12,
        width: 220,
        backgroundColor: BRAND.colors.accent,
        borderRadius: 999,
        margin: "40px 0",
      }}
    />
    <div
      style={{
        fontFamily: BRAND.fonts.body,
        fontWeight: 800,
        fontSize: 44,
        letterSpacing: 1,
        color: BRAND.colors.sand,
      }}
    >
      Save this. Follow for more.
    </div>
  </Slide>
);

export const Carousel: React.FC<ReelProps> = ({ hook, beats, signoff }) => {
  const frame = useCurrentFrame();
  const slides = [
    <Cover key="cover" hook={hook} />,
    ...beats.map((b, i) => (
      <Beat key={i} text={b} index={i} total={beats.length} />
    )),
    <CTA key="cta" signoff={signoff} />,
  ];
  return slides[Math.min(frame, slides.length - 1)];
};
