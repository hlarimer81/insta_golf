import React from "react";
import { AbsoluteFill } from "remotion";
import { BRAND } from "./brand";

/**
 * Square (1080×1080) brand avatar for the Bogey Golf Instagram profile.
 * Instagram crops avatars to a circle, so everything sits inside a circular
 * safe zone. Rendered as a still:  npm run profile  →  out/bogey-profile.png
 */
export const ProfilePic: React.FC = () => {
  return (
    <AbsoluteFill
      style={{
        backgroundColor: BRAND.colors.green,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      {/* Accent ring, inset well within Instagram's circular crop. */}
      <div
        style={{
          position: "absolute",
          width: 900,
          height: 900,
          borderRadius: 999,
          border: `10px solid ${BRAND.colors.accent}`,
          opacity: 0.85,
        }}
      />

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        {/* The cap — Bogey's signature mark, drawn in brand colors (the 🧢
            emoji renders blue, which clashes with the palette). */}
        <svg
          width="360"
          height="230"
          viewBox="0 0 320 200"
          style={{ marginBottom: 18, filter: "drop-shadow(0 8px 20px rgba(0,0,0,0.35))" }}
        >
          {/* crown */}
          <path d="M60,140 A110,90 0 0 1 280,140 Z" fill={BRAND.colors.cream} />
          {/* bill / brim, sweeping to the front-left */}
          <path
            d="M60,140 C 20,142 4,168 46,170 C 112,171 150,150 166,140 Z"
            fill={BRAND.colors.accent}
          />
          {/* top button */}
          <circle cx="170" cy="52" r="11" fill={BRAND.colors.accent} />
        </svg>

        <div
          style={{
            fontFamily: BRAND.fonts.display,
            fontWeight: 900,
            fontSize: 190,
            letterSpacing: 6,
            color: BRAND.colors.cream,
            lineHeight: 1,
            textShadow: "0 6px 30px rgba(0,0,0,0.45)",
          }}
        >
          BOGEY
        </div>

        <div
          style={{
            height: 14,
            width: 300,
            backgroundColor: BRAND.colors.accent,
            borderRadius: 999,
            margin: "26px 0 22px",
          }}
        />

        {/* Trailing letter-spacing pushes the text right; pad left to recenter. */}
        <div
          style={{
            fontFamily: BRAND.fonts.body,
            fontWeight: 800,
            fontSize: 60,
            letterSpacing: 26,
            paddingLeft: 26,
            color: BRAND.colors.sand,
          }}
        >
          GOLF
        </div>
      </div>
    </AbsoluteFill>
  );
};
