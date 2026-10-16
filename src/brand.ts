/**
 * Bogey's brand kit. Change these in one place and every Reel restyles.
 * Bogey = the everyman caddie. Dry, honest, encouraging. Text-on-screen only.
 */
export const BRAND = {
  colors: {
    green: "#0B3D2E", // deep fairway green (backgrounds)
    greenLight: "#1B5E20",
    cream: "#F5F0E1", // primary text
    sand: "#E4D5B7",
    accent: "#F2C14E", // golf-flag yellow (hook emphasis / underline)
    ink: "#0A0A0A",
  },
  fonts: {
    // System stack for now — swap to a loaded @remotion/google-fonts family later.
    display: '"Arial Black", "Helvetica Neue", Arial, sans-serif',
    body: '"Helvetica Neue", Arial, sans-serif',
  },
  // The last card asks for the one action Instagram rewards: a save on a tip,
  // a send on a joke. "Keep it in the short grass" asked for nothing, and in
  // ~80 posts the account logged one save and one share.
  signoffs: {
    tip: "Save this for your next round.",
    joke: "Send this to the guy who does this.",
  },
} as const;

// Reel canvas + default pacing. Text-on-screen only, so every card has to be
// readable at a glance. It used to be unhurried (3s cards, ~24s tip Reels);
// cut to ~10s in Oct 2026 because watch-through is what Reels rank on, and
// every post was stalling at the size of Instagram's initial test audience.
export const VIDEO = {
  width: 1080,
  height: 1920,
  fps: 30,
  hookSeconds: 2,
  secondsPerBeat: 2.2,
  signoffSeconds: 2,
  // A joke's punchline card holds longer than a beat — the laugh needs a moment.
  punchSeconds: 3,
} as const;

// Square-ish canvas shared by the swipeable carousel and single-image memes.
export const POST = {
  width: 1080,
  height: 1350,
} as const;

/** The sign-off card: an explicit one wins, else the CTA for the script's kind. */
export const signoffFor = (p: { signoff?: string | null; punchline?: string | null }) =>
  p.signoff ?? (p.punchline ? BRAND.signoffs.joke : BRAND.signoffs.tip);
