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

// Thin Graph API POST/GET pair bound to a token + version.
function graphClient(token, version) {
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
  return { post, get };
}

// Poll a media container until Instagram finishes processing it.
async function waitForFinished(get, id, attempts, intervalMs) {
  for (let i = 0; i < attempts; i++) {
    const { status_code } = await get(id, { fields: "status_code" });
    if (status_code === "FINISHED") return;
    if (status_code === "ERROR") {
      throw new Error("Instagram reported ERROR while processing the media.");
    }
    if (i === attempts - 1) {
      throw new Error(`Media not processed after ${attempts} polls.`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** Publish a single-video Reel: create container → wait → publish. */
export async function graphPublish({
  igUser,
  token,
  videoUrl,
  caption,
  version = "v21.0",
  pollAttempts = 30,
  pollIntervalMs = 10000,
}) {
  const { post, get } = graphClient(token, version);
  const container = await post(`${igUser}/media`, {
    media_type: "REELS",
    video_url: videoUrl,
    caption,
  });
  await waitForFinished(get, container.id, pollAttempts, pollIntervalMs);
  const published = await post(`${igUser}/media_publish`, {
    creation_id: container.id,
  });
  return published.id;
}

/**
 * Publish an image carousel: create one child container per image → bundle
 * them into a carousel container → wait → publish. `imageUrls` is ordered
 * (slide 1 first).
 */
export async function graphPublishCarousel({
  igUser,
  token,
  imageUrls,
  caption,
  version = "v21.0",
  pollAttempts = 20,
  pollIntervalMs = 5000,
}) {
  const { post, get } = graphClient(token, version);
  const childIds = [];
  for (const url of imageUrls) {
    const child = await post(`${igUser}/media`, {
      image_url: url,
      is_carousel_item: "true",
    });
    childIds.push(child.id);
  }
  const container = await post(`${igUser}/media`, {
    media_type: "CAROUSEL",
    children: childIds.join(","),
    caption,
  });
  await waitForFinished(get, container.id, pollAttempts, pollIntervalMs);
  const published = await post(`${igUser}/media_publish`, {
    creation_id: container.id,
  });
  return published.id;
}
