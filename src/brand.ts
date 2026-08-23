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
  signoff: "Keep it in the short grass. — Bogey",
} as const;

// Reel canvas + default pacing. Text-on-screen only, so every card has to be
// readable at a glance — pacing is deliberately unhurried.
export const VIDEO = {
  width: 1080,
  height: 1920,
  fps: 30,
  hookSeconds: 3,
  secondsPerBeat: 3,
  signoffSeconds: 2.5,
  // A joke's punchline card holds longer than a beat — the laugh needs a moment.
  punchSeconds: 4,
} as const;

// Square-ish canvas shared by the swipeable carousel and single-image memes.
export const POST = {
  width: 1080,
  height: 1350,
} as const;
