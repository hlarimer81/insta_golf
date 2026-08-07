/**
 * Small S3 helpers shared by the local enqueue command and the cloud Lambda.
 * Credentials come from the default AWS chain (env/.env locally, IAM role in
 * Lambda), so nothing here reads secrets directly.
 */
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createReadStream } from "node:fs";

export const makeS3 = (region) => new S3Client({ region });

export async function uploadFile(s3, { bucket, key, path, contentType = "video/mp4" }) {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: createReadStream(path),
      ContentType: contentType,
    }),
  );
}

export function presignGet(s3, { bucket, key, ttl = 3600 }) {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: ttl,
  });
}

export async function getJson(s3, { bucket, key }) {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return JSON.parse(await res.Body.transformToString());
  } catch (e) {
    if (e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404) return null;
    throw e;
  }
}

export async function putJson(s3, { bucket, key, data }) {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(data, null, 2),
      ContentType: "application/json",
    }),
  );
}
