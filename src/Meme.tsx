import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { BRAND } from "./brand";
import type { ReelProps } from "./schema";

/**
 * A single-image golf meme (1080×1350, 4:5) built from a joke script:
 *   top     the setup (script.hook)
 *   bottom  the punchline (script.punchline)
 *
 * One frame, one image — render with:  npm run render:meme -- <slug>
 * An optional brollSrc image sits behind both lines under a heavy scrim, so
 * the text stays readable over whatever the background turned out to be.
 */

const PAD = 84;
const resolveSrc = (src: string): string =>
  /^https?:\/\//.test(src) ? src : staticFile(src);
const isImageSrc = (s: string): boolean => /\.(png|jpe?g|webp|gif|avif)$/i.test(s);

export const Meme: React.FC<ReelProps> = ({ hook, punchline, beats, brollSrc }) => {
  // A tip script has no punchline — fall back to its last beat so the layout
  // never renders half-empty if the wrong slug gets pointed at this comp.
  const payoff = punchline ?? beats[beats.length - 1] ?? "";

  return (
    <AbsoluteFill style={{ backgroundColor: BRAND.colors.green }}>
      {brollSrc && isImageSrc(brollSrc) && (
        <AbsoluteFill>
          <Img
            src={resolveSrc(brollSrc)}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
          {/* Heavy top/bottom scrim, lighter through the middle so the photo
              still reads between the two text blocks. */}
          <AbsoluteFill
            style={{
              background:
                "linear-gradient(180deg, rgba(11,61,46,0.86) 0%, rgba(11,61,46,0.46) 42%, rgba(11,61,46,0.58) 62%, rgba(11,61,46,0.9) 100%)",
            }}
          />
        </AbsoluteFill>
      )}

      <AbsoluteFill
        style={{
          padding: `${PAD}px ${PAD}px ${PAD - 20}px`,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          textAlign: "center",
        }}
      >
        {/* Setup */}
        <div
          style={{
            fontFamily: BRAND.fonts.display,
            fontWeight: 900,
            fontSize: 76,
            lineHeight: 1.12,
            color: BRAND.colors.cream,
            textShadow: "0 4px 22px rgba(0,0,0,0.6)",
          }}
        >
          {hook}
        </div>

        {/* Punchline */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div
            style={{
              height: 10,
              width: 180,
              backgroundColor: BRAND.colors.accent,
              borderRadius: 999,
              marginBottom: 40,
            }}
          />
          <div
            style={{
              fontFamily: BRAND.fonts.display,
              fontWeight: 900,
              fontSize: 84,
              lineHeight: 1.08,
              color: BRAND.colors.accent,
              textShadow: "0 4px 22px rgba(0,0,0,0.7)",
            }}
          >
            {payoff}
          </div>
          <div
            style={{
              marginTop: 44,
              fontFamily: BRAND.fonts.body,
              fontWeight: 800,
              fontSize: 32,
              letterSpacing: 5,
              color: BRAND.colors.cream,
              opacity: 0.75,
            }}
          >
            BOGEY
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
