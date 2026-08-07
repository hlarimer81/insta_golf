import React from "react";
import { Composition } from "remotion";
import { BogeyReel } from "./BogeyReel";
import { ProfilePic } from "./ProfilePic";
import { Carousel, carouselSlideCount } from "./Carousel";
import { reelSchema, totalFrames, type ReelProps } from "./schema";
import { BRAND, VIDEO } from "./brand";

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
  signoff: BRAND.signoff,
  brollSrc: null,
  audioSrc: null,
  hookSeconds: VIDEO.hookSeconds,
  secondsPerBeat: VIDEO.secondsPerBeat,
  signoffSeconds: VIDEO.signoffSeconds,
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
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

      {/* Square brand avatar — render with:  npm run profile */}
      <Composition
        id="ProfilePic"
        component={ProfilePic}
        width={1080}
        height={1080}
        fps={1}
        durationInFrames={1}
      />

      {/* Swipeable carousel (one slide per frame) — render with:
          npm run render:carousel -- <slug> */}
      <Composition
        id="Carousel"
        component={Carousel}
        schema={reelSchema}
        defaultProps={EXAMPLE}
        width={1080}
        height={1350}
        fps={1}
        durationInFrames={carouselSlideCount(EXAMPLE.beats)}
        calculateMetadata={({ props }) => ({
          durationInFrames: carouselSlideCount(props.beats),
        })}
      />
    </>
  );
};
