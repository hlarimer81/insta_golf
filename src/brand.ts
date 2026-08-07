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

// Reel canvas + default pacing.
export const VIDEO = {
  width: 1080,
  height: 1920,
  fps: 30,
  hookSeconds: 2.5,
  secondsPerBeat: 2.2,
  signoffSeconds: 2,
} as const;
