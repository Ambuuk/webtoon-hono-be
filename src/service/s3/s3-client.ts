import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const r2 = new S3Client({
  region: "auto", // R2 ignores region, just use "auto"
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const bucket = "hmanhwa";

export async function generateR2GetUrl(key: string, expiresMinutes = 10) {
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  const url = await getSignedUrl(r2, command, {
    expiresIn: expiresMinutes * 60, // seconds
  });

  return url;
}

export async function deleteImage(key: string) {
  const command = new DeleteObjectCommand({
    Bucket: bucket,
    Key: key,
  });
  await r2.send(command);
}

export async function deleteMany(keys: string[]) {
  const command = new DeleteObjectsCommand({
    Bucket: bucket,
    Delete: {
      Objects: keys.map((k) => ({ Key: k })),
    },
  });

  await r2.send(command);
}

export async function generateUploadUrl(
  key: string,
  expiresMinutes = 1,
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    // ContentType: contentType,
  });

  return await getSignedUrl(r2, command, {
    expiresIn: expiresMinutes * 60, // seconds
  });
}
