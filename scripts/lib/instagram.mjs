/**
 * Instagram publishing primitives — no filesystem or AWS deps, so both the
 * local CLI and the cloud Lambda can import them cheaply.
 */

/** Build a post caption from a reel. An explicit `caption` field wins. */
export function buildCaption(reel) {
  if (reel.caption && reel.caption.trim()) return reel.caption.trim();
  const hashtags = (
    process.env.IG_HASHTAGS || "#golf #golftips #golfswing #golflife #golftok"
  ).trim();
  return [reel.hook, "", ...reel.beats, "", hashtags].join("\n");
}

/**
 * Run Instagram's 3-step Reels publish: create container → poll until the
 * video is processed → publish. All inputs are explicit params (no env reads)
 * so the caller controls config. Returns the published media id.
 */
export async function graphPublish({
  igUser,
  token,
  videoUrl,
  caption,
  version = "v21.0",
  pollAttempts = 30,
  pollIntervalMs = 10000,
}) {
  const base = `https://graph.facebook.com/${version}`;

  const post = async (path, params) => {
    const res = await fetch(`${base}/${path}`, {
      method: "POST",
      body: new URLSearchParams({ ...params, access_token: token }),
    });
    const j = await res.json();
    if (!res.ok || j.error) {
      throw new Error(`Graph POST ${path}: ${j.error?.message ?? res.statusText}`);
    }
    return j;
  };
  const get = async (path, params) => {
    const qs = new URLSearchParams({ ...params, access_token: token });
    const res = await fetch(`${base}/${path}?${qs}`);
    const j = await res.json();
    if (!res.ok || j.error) {
      throw new Error(`Graph GET ${path}: ${j.error?.message ?? res.statusText}`);
    }
    return j;
  };

  const container = await post(`${igUser}/media`, {
    media_type: "REELS",
    video_url: videoUrl,
    caption,
  });
  for (let i = 0; i < pollAttempts; i++) {
    const { status_code } = await get(container.id, { fields: "status_code" });
    if (status_code === "FINISHED") break;
    if (status_code === "ERROR") {
      throw new Error("Instagram reported ERROR while processing the video.");
    }
    if (i === pollAttempts - 1) {
      throw new Error(`Video not processed after ${pollAttempts} polls.`);
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  const published = await post(`${igUser}/media_publish`, {
    creation_id: container.id,
  });
  return published.id;
}
