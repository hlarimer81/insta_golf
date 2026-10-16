/**
 * Shared Instagram stats fetching, used by both the `npm run stats` CLI and the
 * weekly report the GitHub Action emails out. Keeping one implementation means
 * the numbers in the email always match the numbers in the terminal.
 */

// Graph GET that returns errors instead of throwing, so one bad call doesn't
// sink a whole report.
export async function gget(token, version, path, params) {
  const qs = new URLSearchParams({ ...params, access_token: token });
  const res = await fetch(`https://graph.facebook.com/${version}/${path}?${qs}`);
  const json = await res.json();
  return { ok: res.ok && !json.error, json, error: json.error };
}

/**
 * Fetch per-post numbers for every published entry that has a media id.
 * Returns { rows, scopeHint } — scopeHint is true when insights were refused
 * for want of the `instagram_manage_insights` permission.
 */
export async function fetchStats({ token, version, metrics, entries }) {
  const published = entries
    .filter((e) => e.status === "published" && e.mediaId)
    .sort((a, b) => (a.postedAt ?? a.publishAt).localeCompare(b.postedAt ?? b.publishAt));

  const rows = [];
  let scopeHint = false;

  for (const e of published) {
    const media = await gget(token, version, e.mediaId, {
      fields: "permalink,timestamp,like_count,comments_count",
    });

    // Try the configured metrics; fall back to reach-only if the set is
    // rejected (Instagram occasionally renames metrics).
    let insights = {};
    let r = await gget(token, version, `${e.mediaId}/insights`, { metric: metrics.join(",") });
    if (!r.ok) {
      const r2 = await gget(token, version, `${e.mediaId}/insights`, { metric: "reach" });
      if (r2.ok) r = r2;
      else if (/permission|insights/i.test(r.error?.message ?? "")) scopeHint = true;
    }
    if (r.ok) for (const m of r.json.data ?? []) insights[m.name] = m.values?.[0]?.value;

    rows.push({
      date: (e.postedAt ?? media.json.timestamp ?? e.publishAt).slice(0, 10),
      slug: e.slug,
      permalink: media.json.permalink,
      // A Reel's permalink is /reel/; a static feed post is /p/. This is the
      // only reliable format signal after the fact.
      isReel: (media.json.permalink ?? "").includes("/reel/"),
      views: insights.views,
      reach: insights.reach,
      likes: media.json.like_count,
      comments: media.json.comments_count,
      saved: insights.saved,
      shares: insights.shares,
    });
  }
  return { rows, scopeHint };
}

/**
 * Page tokens don't expire, but their DATA ACCESS does — 60 days from the last
 * authorization. When it lapses, insights reads start failing and unattended
 * automation dies quietly, so the weekly report carries this countdown.
 */
export async function tokenHealth({ token, version }) {
  const r = await gget(token, version, "debug_token", { input_token: token });
  if (!r.ok) return { ok: false, error: r.error?.message ?? "debug_token failed" };
  const d = r.json.data ?? {};
  const daysUntil = (ts) => (ts ? Math.round((ts * 1000 - Date.now()) / 86400000) : null);
  return {
    ok: true,
    valid: d.is_valid,
    type: d.type,
    expiresInDays: d.expires_at ? daysUntil(d.expires_at) : null, // null = never
    dataAccessExpiresInDays: daysUntil(d.data_access_expires_at),
    dataAccessExpiresOn: d.data_access_expires_at
      ? new Date(d.data_access_expires_at * 1000).toISOString().slice(0, 10)
      : null,
    scopes: d.scopes ?? [],
  };
}

/** Sum a numeric field across rows, ignoring the ones the API didn't return. */
export const sum = (rows, k) => rows.reduce((n, r) => n + (typeof r[k] === "number" ? r[k] : 0), 0);
/** Mean of a numeric field, 0 for an empty set. */
export const avg = (rows, k) => (rows.length ? sum(rows, k) / rows.length : 0);

/**
 * The account itself — id, handle and follower count. A page token's `me` is
 * the Facebook Page, which carries the linked IG account, so this needs no
 * IG_USER_ID and works on CI where only the token is configured.
 */
export async function fetchAccount({ token, version, igUserId = process.env.IG_USER_ID }) {
  const r = igUserId
    ? await gget(token, version, igUserId, { fields: "id,username,followers_count,media_count" })
    : await gget(token, version, "me", {
        fields: "instagram_business_account{id,username,followers_count,media_count}",
      });
  if (!r.ok) return { ok: false, error: r.error?.message ?? "account lookup failed" };
  const a = igUserId ? r.json : r.json.instagram_business_account;
  if (!a) return { ok: false, error: "token's Page has no linked Instagram account" };
  return {
    ok: true,
    id: a.id,
    username: a.username,
    followers: a.followers_count,
    mediaCount: a.media_count,
  };
}

/**
 * New followers per day for up to the last 30 days, from account insights.
 * Instagram only serves this to accounts with 100+ followers and only for 30
 * days back, so a null here is normal for a small account — the daily snapshot
 * in S3 (lib/followers.mjs) is the record that always exists.
 */
export async function fetchFollowerGains({ token, version, igUserId, days = 30 }) {
  const until = Math.floor(Date.now() / 1000);
  const since = until - Math.min(days, 30) * 86400;
  const r = await gget(token, version, `${igUserId}/insights`, {
    metric: "follower_count",
    period: "day",
    since: String(since),
    until: String(until),
  });
  if (!r.ok) return { ok: false, error: r.error?.message ?? "follower_count refused" };
  const values = r.json.data?.[0]?.values ?? [];
  return {
    ok: true,
    // end_time is the close of the day being counted, so the day is the one before it.
    daily: values.map((v) => ({
      date: new Date(new Date(v.end_time).getTime() - 86400000).toISOString().slice(0, 10),
      gained: v.value,
    })),
  };
}
