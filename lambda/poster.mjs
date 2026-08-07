/**
 * Daily Instagram poster (AWS Lambda, triggered by EventBridge cron).
 *
 * Reads the cloud queue from S3, finds the next due, pending Reel (video
 * already uploaded to S3, caption baked in at enqueue time), publishes it via
 * the Graph API, and writes the updated status back to the queue.
 *
 * No rendering, no local files — just S3 + Graph API calls.
 *
 * Config via environment: S3_BUCKET, IG_USER_ID, and either IG_ACCESS_TOKEN
 * (env) or IG_TOKEN_SECRET (a Secrets Manager id/ARN). Optional:
 * CLOUD_QUEUE_KEY (default queue.json), MAX_POSTS_PER_RUN (default 1),
 * GRAPH_API_VERSION, S3_URL_TTL, IG_POLL_ATTEMPTS, IG_POLL_INTERVAL_MS.
 */
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { makeS3, presignGet, getJson, putJson } from "../scripts/lib/s3.mjs";
import { graphPublish } from "../scripts/lib/instagram.mjs";

let cachedToken;
async function getToken(region) {
  if (process.env.IG_ACCESS_TOKEN) return process.env.IG_ACCESS_TOKEN;
  if (cachedToken) return cachedToken;
  const sm = new SecretsManagerClient({ region });
  const res = await sm.send(new GetSecretValueCommand({ SecretId: process.env.IG_TOKEN_SECRET }));
  let value = res.SecretString ?? "";
  // Accept either a raw token or a JSON blob like {"IG_ACCESS_TOKEN": "..."}.
  try {
    const j = JSON.parse(value);
    value = j.IG_ACCESS_TOKEN ?? j.token ?? value;
  } catch {
    /* raw string token */
  }
  cachedToken = value;
  return value;
}

export async function handler() {
  const region = process.env.AWS_REGION;
  const bucket = process.env.S3_BUCKET;
  const queueKey = process.env.CLOUD_QUEUE_KEY ?? "queue.json";
  const maxPosts = parseInt(process.env.MAX_POSTS_PER_RUN ?? "1", 10);
  const s3 = makeS3(region);

  const queue = (await getJson(s3, { bucket, key: queueKey })) ?? { entries: [] };
  const now = Date.now();
  const due = queue.entries
    .filter((e) => e.status === "pending" && new Date(e.publishAt).getTime() <= now)
    .sort((a, b) => a.publishAt.localeCompare(b.publishAt))
    .slice(0, maxPosts);

  if (due.length === 0) {
    console.log("Nothing due.");
    return { posted: 0 };
  }

  const token = await getToken(region);
  let posted = 0;
  for (const e of due) {
    try {
      const videoUrl = await presignGet(s3, {
        bucket,
        key: e.videoKey,
        ttl: parseInt(process.env.S3_URL_TTL ?? "3600", 10),
      });
      const mediaId = await graphPublish({
        igUser: process.env.IG_USER_ID,
        token,
        videoUrl,
        caption: e.caption,
        version: process.env.GRAPH_API_VERSION ?? "v21.0",
        pollAttempts: parseInt(process.env.IG_POLL_ATTEMPTS ?? "24", 10),
        pollIntervalMs: parseInt(process.env.IG_POLL_INTERVAL_MS ?? "10000", 10),
      });
      e.status = "published";
      e.mediaId = mediaId;
      e.postedAt = new Date().toISOString();
      e.error = null;
      posted++;
      console.log(`Posted ${e.slug} → ${mediaId}`);
    } catch (err) {
      e.status = "failed";
      e.error = String(err?.message ?? err);
      console.error(`Failed ${e.slug}: ${e.error}`);
    }
    // Persist after each item so a mid-batch failure doesn't lose state.
    await putJson(s3, { bucket, key: queueKey, data: queue });
  }

  return { posted };
}
