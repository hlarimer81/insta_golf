import React from "react";
import { Composition } from "remotion";
import { BogeyReel } from "./BogeyReel";
import { reelSchema, totalFrames, type ReelProps } from "./schema";
import { VIDEO } from "./brand";

// A built-in example so Studio opens with something to look at.
const EXAMPLE: ReelProps = {
  slug: "stop-buying-a-new-driver",
  hook: "Stop buying a new driver.",
  beats: [
    "Your driver isn't the problem.",
    "Your tee height is.",
    "Ball should sit half above the crown.",
    "Free 15 yards. You're welcome.",
  ],
  signoff: "Keep it in the short grass. — Bogey 🧢",
  brollSrc: null,
  audioSrc: null,
  hookSeconds: VIDEO.hookSeconds,
  secondsPerBeat: VIDEO.secondsPerBeat,
  signoffSeconds: VIDEO.signoffSeconds,
};

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="BogeyReel"
      component={BogeyReel}
      schema={reelSchema}
      defaultProps={EXAMPLE}
      fps={VIDEO.fps}
      width={VIDEO.width}
      height={VIDEO.height}
      durationInFrames={totalFrames(EXAMPLE)}
      // Recompute duration from whatever props/script are passed at render time.
      calculateMetadata={({ props }) => ({
        durationInFrames: totalFrames(props),
      })}
    />
  );
};
