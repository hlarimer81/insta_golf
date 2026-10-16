/**
 * Follower history, kept as one snapshot per day in S3.
 *
 * Instagram exposes the current follower count but no history of it for an
 * account under 100 followers, and only 30 days of history above that. So the
 * daily top-up job records the count here, and the report and `npm run stats`
 * read growth off these snapshots.
 */
import { getJson, putJson } from "./s3.mjs";

const keyOf = () => process.env.FOLLOWERS_KEY ?? "followers.json";

export async function loadFollowerHistory(s3, bucket) {
  const doc = await getJson(s3, { bucket, key: keyOf() });
  return (doc?.snapshots ?? []).sort((a, b) => a.date.localeCompare(b.date));
}

/** Upsert today's count; re-running on the same day just overwrites it. */
export async function recordFollowers(s3, bucket, { followers, date = new Date().toISOString().slice(0, 10) }) {
  const snapshots = (await loadFollowerHistory(s3, bucket)).filter((s) => s.date !== date);
  snapshots.push({ date, followers });
  snapshots.sort((a, b) => a.date.localeCompare(b.date));
  await putJson(s3, { bucket, key: keyOf(), data: { snapshots } });
  return snapshots;
}

/** The latest snapshot taken on or before `date`, or null. */
export const countOn = (snapshots, date) =>
  snapshots.filter((s) => s.date <= date).at(-1) ?? null;

/**
 * Net follower change over [from, to], measured from the last snapshot before
 * the window opens. Null when the history doesn't reach back that far — a
 * partial number would read as growth that isn't there.
 */
export function netChange(snapshots, from, to) {
  const dayBefore = new Date(new Date(from + "T00:00:00Z").getTime() - 86400000).toISOString().slice(0, 10);
  const start = countOn(snapshots, dayBefore);
  const end = countOn(snapshots, to);
  if (!start || !end || end.date < from) return null;
  return { from: start, to: end, change: end.followers - start.followers };
}
