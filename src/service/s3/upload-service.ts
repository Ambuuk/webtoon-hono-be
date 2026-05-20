import { PutObjectCommand } from "@aws-sdk/client-s3";
import { PhotonImage, crop } from "@cf-wasm/photon";
import { pool } from "../../database";
import { slugify } from "../../utils/slugger";
import { r2 } from "./s3-client";

const bucket = "hmanhwa";

async function uploadBuffer(buffer: Uint8Array, key: string): Promise<string> {
  await r2.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: "image/webp",
    }),
  );
  return key;
}

export async function splitAndUploadToR2(
  imageBuffer: ArrayBuffer,
  episodeId: number,
): Promise<void> {
  const episode = await pool.query(
    "SELECT * FROM webtoon_episodes WHERE id = $1",
    [episodeId],
  );

  const webtoon = await pool.query(
    "SELECT * FROM webtoons WHERE id = (SELECT webtoon_id FROM webtoon_episodes WHERE id = $1)",
    [episodeId],
  );

  const { rows: existingRows } = await pool.query(
    "SELECT MAX(order_no) AS max_order FROM episode_images WHERE episode_id = $1",
    [episodeId],
  );

  const maxOrder = existingRows[0].max_order ?? 0;

  const inputBytes = new Uint8Array(imageBuffer);
  const image = PhotonImage.new_from_byteslice(inputBytes);
  const width = image.get_width();
  const height = image.get_height();

  const SPLIT_HEIGHT = width <= 800 ? 1280 : 2400;
  const titleSlug = slugify(webtoon.rows[0].title);
  const episodeNumber = episode.rows[0].episode_number;

  if (height <= SPLIT_HEIGHT) {
    const webpBytes = image.get_bytes_webp();
    const key = `${titleSlug}/${episodeNumber}/${crypto.randomUUID()}.webp`;
    await uploadBuffer(webpBytes, key);
    await pool.query(
      "INSERT INTO episode_images (episode_id, image_url, order_no) VALUES ($1, $2, $3)",
      [episodeId, key, maxOrder + 1],
    );
    image.free();
    return;
  }

  const numFullPanels = Math.floor(height / SPLIT_HEIGHT);
  const remainderHeight = height % SPLIT_HEIGHT;

  const slices = Array.from({ length: numFullPanels }, (_, i) => ({
    top: i * SPLIT_HEIGHT,
    height: i === numFullPanels - 1 ? SPLIT_HEIGHT + remainderHeight : SPLIT_HEIGHT,
    index: i,
  }));

  for (let i = 0; i < slices.length; i++) {
    const { top, height: sliceHeight, index } = slices[i];
    const panel = crop(image, 0, top, width, top + sliceHeight);
    const webpBytes = panel.get_bytes_webp();
    panel.free();

    const orderNo = maxOrder + index + 1;
    const key = `${titleSlug}/${episodeNumber}/${orderNo}_${crypto.randomUUID()}.webp`;
    await uploadBuffer(webpBytes, key);
    await pool.query(
      "INSERT INTO episode_images (episode_id, image_url, order_no) VALUES ($1, $2, $3)",
      [episodeId, key, orderNo],
    );
  }

  image.free();
}
