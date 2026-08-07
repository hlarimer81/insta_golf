import React from "react";
import {
  AbsoluteFill,
  Audio,
  interpolate,
  OffthreadVideo,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { BRAND } from "./brand";
import type { ReelProps } from "./schema";

/** http(s) URLs pass through; bare paths resolve from the public/ folder. */
const resolveSrc = (src: string): string =>
  /^https?:\/\//.test(src) ? src : staticFile(src);

/** Fairway-green background with an optional b-roll layer + legibility scrim. */
const Background: React.FC<{ brollSrc: string | null }> = ({ brollSrc }) => (
  <AbsoluteFill style={{ backgroundColor: BRAND.colors.green }}>
    {brollSrc && (
      <OffthreadVideo
        src={resolveSrc(brollSrc)}
        muted
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
    )}
    {/* Dark scrim keeps cream text readable over any footage. */}
    <AbsoluteFill
      style={{
        background:
          "linear-gradient(180deg, rgba(11,61,46,0.55) 0%, rgba(11,61,46,0.25) 40%, rgba(11,61,46,0.75) 100%)",
      }}
    />
  </AbsoluteFill>
);

/** Persistent "🧢 BOGEY" wordmark, top-left. */
const Wordmark: React.FC = () => (
  <div
    style={{
      position: "absolute",
      top: 70,
      left: 70,
      fontFamily: BRAND.fonts.body,
      fontWeight: 800,
      fontSize: 42,
      letterSpacing: 2,
      color: BRAND.colors.cream,
      opacity: 0.9,
      textShadow: "0 2px 12px rgba(0,0,0,0.5)",
    }}
  >
    🧢 BOGEY
  </div>
);

/** Small progress dots so viewers feel momentum through the beats. */
const Dots: React.FC<{ count: number; active: number }> = ({
  count,
  active,
}) => (
  <div
    style={{
      position: "absolute",
      bottom: 220,
      width: "100%",
      display: "flex",
      justifyContent: "center",
      gap: 16,
    }}
  >
    {Array.from({ length: count }).map((_, i) => (
      <div
        key={i}
        style={{
          width: 16,
          height: 16,
          borderRadius: 999,
          backgroundColor:
            i === active ? BRAND.colors.accent : "rgba(245,240,225,0.35)",
        }}
      />
    ))}
  </div>
);

/** One centered text card that springs up + fades in. */
const TextCard: React.FC<{
  text: string;
  fontSize: number;
  accentUnderline?: boolean;
}> = ({ text, fontSize, accentUnderline }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 14 });
  const y = interpolate(enter, [0, 1], [40, 0]);
  const opacity = interpolate(enter, [0, 1], [0, 1]);

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        padding: "0 90px",
      }}
    >
      <div style={{ transform: `translateY(${y}px)`, opacity }}>
        <div
          style={{
            fontFamily: BRAND.fonts.display,
            fontWeight: 900,
            fontSize,
            lineHeight: 1.08,
            color: BRAND.colors.cream,
            textAlign: "center",
            textShadow: "0 4px 24px rgba(0,0,0,0.6)",
          }}
        >
          {text}
        </div>
        {accentUnderline && (
          <div
            style={{
              height: 10,
              width: interpolate(enter, [0, 1], [0, 220]),
              backgroundColor: BRAND.colors.accent,
              borderRadius: 999,
              margin: "34px auto 0",
            }}
          />
        )}
      </div>
    </AbsoluteFill>
  );
};

export const BogeyReel: React.FC<ReelProps> = (props) => {
  const { fps } = useVideoConfig();
  const {
    hook,
    beats,
    signoff,
    brollSrc,
    audioSrc,
    hookSeconds,
    secondsPerBeat,
    signoffSeconds,
  } = props;

  const hookFrames = Math.round(hookSeconds * fps);
  const beatFrames = Math.round(secondsPerBeat * fps);
  const signoffFrames = Math.round(signoffSeconds * fps);

  const frame = useCurrentFrame();
  const activeBeat = Math.floor((frame - hookFrames) / beatFrames);

  return (
    <AbsoluteFill>
      <Background brollSrc={brollSrc} />
      <Wordmark />

      {audioSrc && <Audio src={resolveSrc(audioSrc)} volume={0.35} />}

      {/* Hook */}
      <Sequence durationInFrames={hookFrames}>
        <TextCard text={hook} fontSize={96} accentUnderline />
      </Sequence>

      {/* Beats */}
      {beats.map((beat, i) => (
        <Sequence
          key={i}
          from={hookFrames + i * beatFrames}
          durationInFrames={beatFrames}
        >
          <TextCard text={beat} fontSize={80} />
        </Sequence>
      ))}

      {/* Beat progress dots (only during the beats section) */}
      {activeBeat >= 0 && activeBeat < beats.length && (
        <Dots count={beats.length} active={activeBeat} />
      )}

      {/* Sign-off */}
      <Sequence
        from={hookFrames + beats.length * beatFrames}
        durationInFrames={signoffFrames}
      >
        <TextCard text={signoff} fontSize={64} />
      </Sequence>
    </AbsoluteFill>
  );
};
