import { PhotonImage } from "@cf-wasm/photon";
import { pool } from "../../database";
import pLimit from "p-limit";
import { TWENTY_FOUR_HOURS } from "../../const/redis-const";
import { redisGet, redisSet } from "../../database/redis";

export interface OcrBubble {
  text: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type OcrImageResult = OcrBubble[];
export type OcrEpisodeResult = OcrImageResult[];

export async function ocrEpisode(episodeId: number) {
  const images = await pool.query(
    "SELECT image_url, id FROM episode_images WHERE episode_id = $1",
    [episodeId],
  );

  const limit = pLimit(3);
  const batchSize = 3;
  const tasks = [];

  for (let i = 0; i < images.rows.length; i += batchSize) {
    const batchIndex = i;
    const task = limit(async () => {
      const batch = images.rows
        .slice(batchIndex, batchIndex + batchSize)
        .map((row) => "https://cdn.hmanhwa.xyz/" + row.image_url);

      const batchOcrResult = await performOCR(batch);

      if (batchOcrResult.length === 0) {
        console.warn(`No OCR results for batch starting at index ${batchIndex}`);
        return;
      }

      for (let j = 0; j < batch.length; j++) {
        const ocrResults = batchOcrResult[j];
        await saveOcrResults(images.rows[batchIndex + j].id, ocrResults);
      }
    });

    tasks.push(task);
  }

  await Promise.all(tasks);
  return { success: true, message: "OCR completed successfully" };
}

async function saveOcrResults(episodeImageId: number, ocrResults: OcrImageResult) {
  for (const bubble of ocrResults) {
    if (bubble.text.trim() === "") continue;

    const { rows: imageRows } = await pool.query(
      "select image_url from episode_images where id = $1",
      [episodeImageId],
    );

    const imageUrl = "https://cdn.hmanhwa.xyz/" + imageRows[0].image_url;
    const res = await fetch(imageUrl);
    const arrayBuffer = await res.arrayBuffer();
    const img = PhotonImage.new_from_byteslice(new Uint8Array(arrayBuffer));
    const width = img.get_width();
    const height = img.get_height();
    img.free();

    await pool.query(
      "update episode_images set canvas_width = $1, canvas_height = $2 where id = $3",
      [width, height, episodeImageId],
    );

    const normalized = normalizeText(bubble.text);
    const tm = await findTranslation(normalized);

    if (tm == null) continue;

    const textToStore = tm ?? bubble.text;

    const style = {
      color: "#000000",
      backgroundColor: "transparent",
      shape: "rect",
      fontFamily: "Irina",
      fontSize: getBubbleFontSize(bubble.text, bubble.width, bubble.height),
      bold: false,
      italic: false,
      underline: false,
      charSpacing: null,
      lineHeight: null,
      outlineColor: null,
      outlineWidth: null,
    };

    await pool.query(
      `
      INSERT INTO bubble (
        id, image_id, group_id, segment_index,
        top_ratio, left_ratio, width, height, angle,
        style, original_text, translated_text
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (id) DO UPDATE SET
        image_id = EXCLUDED.image_id,
        group_id = EXCLUDED.group_id,
        segment_index = EXCLUDED.segment_index,
        top_ratio = EXCLUDED.top_ratio,
        left_ratio = EXCLUDED.left_ratio,
        width = EXCLUDED.width,
        height = EXCLUDED.height,
        angle = EXCLUDED.angle,
        style = EXCLUDED.style,
        original_text = EXCLUDED.original_text,
        translated_text = EXCLUDED.translated_text
      RETURNING *
      `,
      [
        crypto.randomUUID(),
        episodeImageId,
        null,
        1,
        bubble.y,
        bubble.x,
        bubble.width,
        bubble.height,
        0,
        JSON.stringify(style),
        bubble.text,
        textToStore,
      ],
    );
  }
}

async function performOCR(imageUrls: string[]): Promise<OcrEpisodeResult> {
  try {
    const response = await fetch("https://ocr.hmanhwa.xyz/ocr/episode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ images: imageUrls }),
    });
    const data = (await response.json()) as { bubbles: OcrEpisodeResult };
    return data.bubbles;
  } catch (err) {
    console.error("OCR error:", err);
    return [];
  }
}

function getBubbleFontSize(text: string, width: number, height: number): number {
  const presets = [12, 16, 20, 24, 28, 32];
  const charCount = text.length || 1;
  const avgCharWidth = width / charCount;
  const widthBased = avgCharWidth / 0.55;
  const heightBased = height * 0.5;
  const estimated = (widthBased + heightBased) / 2;
  return presets.reduce((prev, curr) =>
    Math.abs(curr - estimated) < Math.abs(prev - estimated) ? curr : prev,
  );
}

function normalizeText(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function hash(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

export async function findTranslation(text: string) {
  const normalized = normalizeText(text);
  if (!normalized) return null;

  const key = `tm:${await hash(normalized)}`;
  const cached = await redisGet(key);

  if (cached) {
    try {
      return JSON.parse(cached).text;
    } catch {
      return cached;
    }
  }

  const result = await pool.query(
    `
    SELECT translated_text, score
    FROM webtoon.translation_memory
    WHERE source_text = $1
    ORDER BY score DESC, updated_at DESC
    LIMIT 1
    `,
    [normalized],
  );

  const row = result.rows[0];
  if (!row) return null;

  if (row.translated_text) {
    await redisSet(
      key,
      JSON.stringify({ text: row.translated_text, score: row.score }),
      TWENTY_FOUR_HOURS,
    );
  }

  return row.translated_text;
}

function hasCyrillic(text: string): boolean {
  return /[Ѐ-ӿ]/.test(text);
}

export async function updateTranslationMemory(source: string, translation: string) {
  const normalized = normalizeText(source);

  if (normalized.length > 40) return;
  if (!hasCyrillic(translation)) return;

  await pool.query(
    `
    INSERT INTO webtoon.translation_memory (source_text, translated_text, score, usage_count)
    VALUES ($1, $2, 1, 1)
    ON CONFLICT (source_text, translated_text)
    DO UPDATE SET
      score = translation_memory.score + 1,
      usage_count = translation_memory.usage_count + 1,
      updated_at = NOW()
    `,
    [normalized, translation],
  );

  const bestResult = await pool.query(
    `
    SELECT translated_text, score
    FROM webtoon.translation_memory
    WHERE source_text = $1
    ORDER BY score DESC, updated_at DESC
    LIMIT 1
    `,
    [normalized],
  );

  const row = bestResult.rows[0];
  if (row) {
    const key = `tm:${await hash(normalized)}`;
    await redisSet(
      key,
      JSON.stringify({ text: row.translated_text, score: row.score }),
      TWENTY_FOUR_HOURS,
    );
  }
}
