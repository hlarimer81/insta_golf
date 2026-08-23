import React from "react";
import { Composition } from "remotion";
import { BogeyReel } from "./BogeyReel";
import { ProfilePic } from "./ProfilePic";
import { Carousel, carouselSlideCount } from "./Carousel";
import { Meme } from "./Meme";
import { MemeReel, memeReelFrames } from "./MemeReel";
import { reelSchema, totalFrames, type ReelProps } from "./schema";
import { BRAND, POST, VIDEO } from "./brand";

// A built-in example so Studio opens with something to look at.
const EXAMPLE: ReelProps = {
  slug: "stop-buying-a-new-driver",
  kind: "tip",
  hook: "Stop buying a new driver.",
  beats: [
    "Your driver isn't the problem.",
    "Your tee height is.",
    "Ball should sit half above the crown.",
    "Free 15 yards. You're welcome.",
  ],
  visuals: [],
  punchline: null,
  signoff: BRAND.signoff,
  brollSrc: null,
  audioSrc: null,
  hookSeconds: VIDEO.hookSeconds,
  secondsPerBeat: VIDEO.secondsPerBeat,
  punchSeconds: VIDEO.punchSeconds,
  signoffSeconds: VIDEO.signoffSeconds,
};

// A joke, so Studio also opens with the humor formats to look at.
const EXAMPLE_JOKE: ReelProps = {
  ...EXAMPLE,
  slug: "provisional",
  kind: "joke",
  hook: "Nobody has ever hit a good provisional.",
  beats: ["The first one is lost.", "So you swing free.", "Dead center, 280."],
  punchline: "Now you have to find the first one.",
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
        width={POST.width}
        height={POST.height}
        fps={1}
        durationInFrames={carouselSlideCount(EXAMPLE.beats)}
        calculateMetadata={({ props }) => ({
          durationInFrames: carouselSlideCount(props.beats),
        })}
      />

      {/* The same joke as a short Reel (setup holds, punchline drops) —
          render with:  npm run render:meme -- <slug> --reel */}
      <Composition
        id="MemeReel"
        component={MemeReel}
        schema={reelSchema}
        defaultProps={EXAMPLE_JOKE}
        fps={VIDEO.fps}
        width={VIDEO.width}
        height={VIDEO.height}
        durationInFrames={memeReelFrames(EXAMPLE_JOKE)}
        calculateMetadata={({ props }) => ({
          durationInFrames: memeReelFrames(props),
        })}
      />

      {/* Single-image golf meme (setup → punchline) — render with:
          npm run render:meme -- <slug> */}
      <Composition
        id="Meme"
        component={Meme}
        schema={reelSchema}
        defaultProps={EXAMPLE_JOKE}
        width={POST.width}
        height={POST.height}
        fps={1}
        durationInFrames={1}
      />
    </>
  );
};
