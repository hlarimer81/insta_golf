import { Config } from "@remotion/cli/config";

// Vertical Reels: 1080x1920. H.264 MP4 is what Instagram wants.
Config.setVideoImageFormat("jpeg");
Config.setCodec("h264");
Config.setOverwriteOutput(true);
