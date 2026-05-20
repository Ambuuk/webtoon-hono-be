import { uploadVideo } from "../admin/admin-service";

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_STREAM_API_KEY;

export async function generateVideoUploadUrl(title: string, description: string) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/stream/direct_upload`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        maxDurationSeconds: 60,
        meta: { app: "nekoma" },
      }),
    },
  );

  const data = (await res.json()) as { result: { uid: string; [key: string]: any } };
  const result = data.result;
  await uploadVideo(title, description, result.uid);
  return result;
}
