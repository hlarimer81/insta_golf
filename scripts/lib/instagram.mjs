/**
 * Instagram publishing primitives — no filesystem or AWS deps, so both the
 * local CLI and the cloud Lambda can import them cheaply.
 */

/**
 * Topic hashtags matched from a script's own words. This is the fallback for
 * scripts written before the generator started emitting a `hashtags` field —
 * a generated tag reads the actual content, where this only spots keywords.
 * Ordered most specific first, since only the first few matches are kept.
 *
 * The broad tags (#golf and friends) are far too large for an account this
 * size to surface in; these are the ones a search can plausibly reach.
 */
const TOPIC_TAGS = [
  [/\brange\b|practice|warm ?up/i, ["#golfpractice"]],
  [/first tee|nerves|pressure|confidence|heart rate/i, ["#golfmentalgame"]],
  [/fried egg|bunker|\bsand\b/i, ["#bunkershot", "#shortgame"]],
  [/\bputt|three-putt|green read/i, ["#putting", "#shortgame"]],
  [/\bchip|pitch shot|pitching\b|around the green/i, ["#chipping", "#shortgame"]],
  [/\bwedge/i, ["#wedgeplay", "#shortgame"]],
  [/\bshank/i, ["#shanks"]],
  [/\bslice|\bfade\b|\bdraw\b/i, ["#slicefix"]],
  [/\bdriver\b|off the tee|\btee it\b|tee box/i, ["#driving", "#teeshot"]],
  [/\biron\b|\birons\b|approach|into the green/i, ["#ironplay"]],
  [/\bgrip|\bglove\b/i, ["#golfgrip"]],
  [/provisional|course management|play for your miss|penalty|\bscore\b|\bwind\b|crosswind|\bbreeze/i, ["#coursemanagement"]],
  [/\bswing|backswing|downswing|takeaway|\btempo\b/i, ["#golfswing"]],
  [/\bstance|\balign|\baim\b|ball position/i, ["#golfsetup"]],
  [/\brough\b|\bdivot\b|pine straw|uphill|downhill/i, ["#troubleshot"]],
];

// Enough to be specific without burying the caption in tags.
const MAX_TOPIC_TAGS = 3;

/** Clean whatever was written into "#tag" form, dropping anything unusable. */
export function normalizeTags(value) {
  const raw = Array.isArray(value) ? value : String(value ?? "").split(/[\s,]+/);
  return raw
    .map((t) => String(t).trim().replace(/^#+/, "").toLowerCase())
    .filter((t) => /^[a-z0-9_]{2,}$/.test(t))
    .map((t) => `#${t}`);
}

/**
 * Topic tags inferred from a script's text. Used when `hashtags` is absent.
 *
 * Tips only, on purpose. A tip is *about* the technique it names, so its words
 * are a fair signal. A joke only mentions golf nouns in passing — "im-due-
 * optimism" rattles off a shank, a three-putt and a provisional while being
 * about none of them — and a confidently wrong niche tag is worse than no tag,
 * because it lands the post in front of people looking for something else.
 * Jokes keep the humor tag set, which already fits them, and newly generated
 * ones carry a `hashtags` field written against the actual joke.
 */
export function topicHashtags(reel) {
  if (reel.kind === "joke") return [];
  const text = [reel.slug, reel.hook, ...(reel.beats ?? []), reel.punchline ?? ""]
    .join(" ")
    .replace(/-/g, " ");
  const out = [];
  for (const [pattern, tags] of TOPIC_TAGS) {
    if (!pattern.test(text)) continue;
    for (const tag of tags) if (!out.includes(tag)) out.push(tag);
    if (out.length >= MAX_TOPIC_TAGS) break;
  }
  return out.slice(0, MAX_TOPIC_TAGS);
}

// Specific tags lead, generic ones follow, nothing repeats.
const mergeTags = (topic, generic) => {
  const seen = new Set();
  const out = [];
  for (const tag of [...topic, ...normalizeTags(generic)]) {
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out.join(" ");
};

/**
 * Build a post caption from a script. An explicit `caption` field wins; then
 * the script's own `hashtags`, else tags matched from its text. The generic
 * set is appended either way, so every post still carries the house tags.
 */
export function buildCaption(reel) {
  if (reel.caption && reel.caption.trim()) return reel.caption.trim();

  const topic = reel.hashtags?.length ? normalizeTags(reel.hashtags) : topicHashtags(reel);

  if (reel.kind === "joke") {
    // Jokes read as setup → punchline. The escalation beats are on-screen
    // timing, not caption copy, so they'd only spoil the pace here.
    const hashtags = mergeTags(
      topic,
      process.env.IG_HASHTAGS_HUMOR || "#golf #golfmemes #golfhumor #golflife #golfproblems",
    );
    return [reel.hook, "", reel.punchline ?? "", "", hashtags]
      .join("\n")
      .replace(/\n{3,}/g, "\n\n");
  }
  const hashtags = mergeTags(
    topic,
    process.env.IG_HASHTAGS || "#golf #golftips #golfswing #golflife #golftok",
  );
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

/** Publish a single image post (a meme): create container → wait → publish. */
export async function graphPublishImage({
  igUser,
  token,
  imageUrl,
  caption,
  version = "v21.0",
  pollAttempts = 20,
  pollIntervalMs = 5000,
}) {
  const { post, get } = graphClient(token, version);
  const container = await post(`${igUser}/media`, {
    image_url: imageUrl,
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
