import type { DecodedIdToken } from "../../types/firebase";
import pLimit from "p-limit";
import { EPISODE_IMAGES_PREFIX, FIVE_MINUTE, IMAGE_DETAIL_PREFIX, ONE_HOUR, TRANSLATOR_WEBTOON_DETAIL_PREFIX, TRANSLATOR_WEBTOON_PREFIX } from "../../const/redis-const";
import { CDN_URL } from "../../const/url-const";
import { PUBLISHED } from "../../const/webtoon-status-const";
import { pool } from "../../database";
import { redisDelete, redisGet, redisSet } from "../../database/redis";
import { translateBubbles } from "../chatgpt/chatgpt-service";
import { findTranslation, updateTranslationMemory } from "../ocr/ocr-service";
import { deleteMany } from "../s3/s3-client";
import {
  checkTranslatorAssignment,
  getUserByFirebaseUid
} from "../util/user-util";

export async function getWebtoonList(uid: string) {
  const cacheKey = TRANSLATOR_WEBTOON_PREFIX + uid;
  const cached = await redisGet(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  const user = await getUserByFirebaseUid(uid);

  const query = `
    SELECT 
      w.id,
      w.title,
      w.cover_url
    FROM translator_webtoons tw
    JOIN webtoons w ON w.id = tw.webtoon_id
    WHERE tw.translator_id = $1
  `;

  const { rows } = await pool.query(query, [user.id]);

  const result = rows.map((row) => ({
    ...row,
    cover_url: CDN_URL + row.cover_url,
  }));

  await redisSet(cacheKey, JSON.stringify(result), ONE_HOUR);
  return result;
}

export async function detailWithEpisodesTranslator(
  user: DecodedIdToken,
  webtoonId: number,
) {
  await checkTranslatorAssignment(user, webtoonId);

  const cacheKey = TRANSLATOR_WEBTOON_DETAIL_PREFIX + webtoonId;
  const cached = await redisGet(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  const { rows } = await pool.query(
    `
    SELECT 
      w.id,
      w.title,
      w.cover_url,
      json_agg(
        json_build_object(
          'id', e.id,
          'episode_number', e.episode_number,
          'status', e.status,
          'sub_required', e.sub_required,
          'translation_status', e.translation_status
        )
        ORDER BY e.episode_number ASC
      ) AS episodes
    FROM webtoons w
    LEFT JOIN webtoon_episodes e
      ON e.webtoon_id = w.id
    WHERE w.id = $1
    GROUP BY w.id
    `,
    [webtoonId],
  );

  if (rows.length === 0) {
    throw new Error("Webtoon not found");
  }

  const webtoon = rows[0];
  webtoon.cover_url = CDN_URL + webtoon.cover_url;
  await redisSet(cacheKey, JSON.stringify(webtoon), ONE_HOUR);
  return webtoon;
}

export async function getEpisodeImages(
  webtoonId: number,
  episode_number: number,
  user: DecodedIdToken,
) {
  await checkTranslatorAssignment(user, webtoonId);

  const cacheKey = EPISODE_IMAGES_PREFIX + `${webtoonId}:${episode_number}`;
  const cached = await redisGet(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  const { rows } = await pool.query(
    `
  SELECT 
    ei.id,
    ei.episode_id,
    ei.image_url,
    ei.edited_image_url,
    ei.order_no,
    ei.created_at,
    ei.status,
    ei.status_desc
  FROM webtoon_episodes e
  JOIN episode_images ei ON ei.episode_id = e.id
  WHERE e.webtoon_id = $1 
    AND e.episode_number = $2
  ORDER BY 
    CASE 
      WHEN ei.status = 'REPORTED' THEN 0
      ELSE 1
    END,
    ei.order_no ASC;
    `,
    [webtoonId, episode_number],
  );

  if (rows.length === 0) {
    throw new Error("Episode not found");
  }
  const result = rows.map((image) => ({
    ...image,
    image_url: image.image_url ? CDN_URL + image.image_url : null,
    edited_image_url: image.edited_image_url
      ? CDN_URL + image.edited_image_url
      : null,
  }));

  await redisSet(cacheKey, JSON.stringify(result), FIVE_MINUTE);
  return result;
}

export async function getImageDetail(
  episodeNumber: number,
  imageId: number,
  webtoonId: number,
  user: DecodedIdToken,
) {
  await checkTranslatorAssignment(user, webtoonId);

  const cacheKey = IMAGE_DETAIL_PREFIX + imageId;
  const cached = await redisGet(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  const { rows } = await pool.query(
    `
    SELECT 
      w.title,
      e.id as episode_id,
      ei.id,
      ei.image_url,
      ei.edited_image_url,
      ei.cleaned_image_url,
      ei.order_no,
      ei.status,
      ei.other_objects,
      ei.canvas_width,
      ei.canvas_height
    FROM webtoon_episodes e
    JOIN webtoons w ON w.id = e.webtoon_id
    JOIN episode_images ei ON ei.episode_id = e.id
    WHERE e.webtoon_id = $1
      AND e.episode_number = $2
      AND ei.id = $3
    LIMIT 1
    `,
    [webtoonId, episodeNumber, imageId]
  );

  if (!rows.length) {
    throw new Error("Image not found");
  }

  const image = rows[0];

  const [nextImage, prevImage, bubbleRes] = await Promise.all([
    pool.query(
      `SELECT id FROM episode_images 
       WHERE id > $1 AND episode_id = $2 
       ORDER BY id ASC LIMIT 1`,
      [imageId, image.episode_id]
    ),
    pool.query(
      `SELECT id FROM episode_images 
       WHERE id < $1 AND episode_id = $2 
       ORDER BY id DESC LIMIT 1`,
      [imageId, image.episode_id]
    ),
    pool.query(
      `SELECT * FROM bubble WHERE image_id = $1`,
      [imageId]
    ),
  ]);


  let bubbles = bubbleRes.rows;

  // if (image.status !== "EDITED") {
  //   for (const bubble of bubbleRes.rows) {
  //     if (bubble.group_id != null)
  //       continue;
  //     if (bubble.original_text == null || bubble.original_text.trim() === "")
  //       continue;
  //     if (bubble.original_text.length > 40) continue;
  //     const translation = await findTranslation(bubble.original_text);
  //     if (!translation) continue;
  //     bubble.translated_text = translation;
  //   }
  // }

  const result = {
    title: image.title,
    imageUrl: image.image_url ? CDN_URL + image.image_url : null,
    editedImageUrl: image.edited_image_url
      ? CDN_URL + image.edited_image_url
      : null,
    cleanedImageUrl: image.cleaned_image_url
      ? CDN_URL + image.cleaned_image_url
      : null,
    orderNo: image.order_no,
    bubbles,
    other_objects: image.other_objects,
    next_image_id: nextImage.rows[0]?.id ?? null,
    previous_image_id: prevImage.rows[0]?.id ?? null,
    canvas_width: image.canvas_width,
    canvas_height: image.canvas_height,
  };

  await redisSet(cacheKey, JSON.stringify(result), FIVE_MINUTE);
  return result;
}

export async function updateEpisodeImage(
  imageId: number,
  editedImageUrl: string,
  bubbles: any[],
  otherObjects: any[],
  canvas_width: number,
  canvas_height: number,
  userInfo: DecodedIdToken
) {
  const client = await pool.connect();
  let oldImageUrl: string | null = null;

  try {
    await client.query("BEGIN");

    const { rows: imageRows } = await client.query(
      `SELECT edited_image_url, episode_id 
       FROM episode_images 
       WHERE id = $1`,
      [imageId]
    );

    if (!imageRows.length) throw new Error("Image not found");

    oldImageUrl = imageRows[0].edited_image_url;
    const episodeId = imageRows[0].episode_id;

    const user = await getUserByFirebaseUid(userInfo.uid);

    // Update episode_images
    await client.query(
      `UPDATE episode_images
   SET edited_image_url = COALESCE($1, edited_image_url),
       other_objects = $2,
       canvas_width = $3,
       canvas_height = $4,
       status = 'EDITED',
       updated_by = $6
   WHERE id = $5`,
      [
        editedImageUrl,
        JSON.stringify(otherObjects),
        canvas_width,
        canvas_height,
        imageId,
        user.id
      ],
    );

    const { rows: existingBubbles } = await client.query(
      `SELECT id, group_id, segment_index 
       FROM bubble 
       WHERE image_id = $1`,
      [imageId]
    );

    const existingMap = new Map(existingBubbles.map(b => [b.id, b]));
    const incomingIds = new Set(bubbles.map(b => b.id).filter(Boolean));

    if (incomingIds.size > 0) {
      await client.query(
        `DELETE FROM bubble WHERE image_id = $1 AND id <> ALL($2::uuid[])`,
        [imageId, Array.from(incomingIds)]
      );
    } else {
      await client.query(
        `DELETE FROM bubble WHERE image_id = $1`,
        [imageId]
      );
    }

    const { rows: nextImageRows } = await client.query(
      `
          SELECT id
          FROM episode_images
          WHERE episode_id = $2
            AND id > $1
          ORDER BY id ASC
          LIMIT 1
          `,
      [imageId, episodeId],
    );

    let nextImageId: number | null = null;

    if (nextImageRows.length > 0) {
      nextImageId = nextImageRows[0].id;
    }


    for (const bubble of bubbles) {
      const existing = existingMap.get(bubble.id);
      let groupId = bubble.group_id ?? existing?.group_id ?? null;

      if (bubble.continuesToNextPanel == 1 && !groupId) {
        const { rows } = await client.query(`
          INSERT INTO bubble_group (image_id)
          VALUES ($1)
          RETURNING id
          `,
          [imageId],
        );
        groupId = rows[0].id;
      }

      const style = {
        color: bubble.color,
        backgroundColor: bubble.backgroundColor,
        shape: bubble.shape,
        fontFamily: bubble.fontFamily,
        fontSize: bubble.fontSize,
        bold: bubble.bold ?? false,
        italic: bubble.italic ?? false,
        underline: bubble.underline ?? false,
        charSpacing: bubble.charSpacing ?? null,
        lineHeight: bubble.lineHeight ?? null,
        outlineColor: bubble.outlineColor ?? null,
        outlineWidth: bubble.outlineWidth ?? null,
        continuesToNextPanel: bubble.continuesToNextPanel ?? 0,
        canvas_height: bubble.canvas_height ?? null,
        canvas_width: bubble.canvas_width ?? null,
        textAlign: bubble.textAlign ?? null,
        glow: bubble.glow ?? null,
        gradient: bubble.gradient ?? null,
        textOpacity: bubble.textOpacity ?? null,
      };

      await client.query(
        `
  INSERT INTO bubble (
    id, image_id, group_id, segment_index,
    top_ratio, left_ratio, width, height, angle,
    style,
    original_text, translated_text
  )
  VALUES (
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12
  )
  ON CONFLICT (id) DO UPDATE
  SET
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
          bubble.id,
          imageId,
          groupId,
          bubble.segment_index ?? 1,
          bubble.top,
          bubble.left,
          bubble.width,
          bubble.height,
          bubble.angle ?? 0,
          JSON.stringify(style),
          bubble.originalText ?? null,
          bubble.translatedText ?? null,
        ],
      );

      if (bubble.originalText && bubble.translatedText) {
        await updateTranslationMemory(
          bubble.originalText,
          bubble.translatedText,
        );
      }

      const { rows: groupBubbles } = await client.query(
        "select * from bubble where group_id = $1",
        [groupId],
      );

      // 🟢 AUTO CREATE CONTINUATION IN NEXT PANEL
      if (bubble.continuesToNextPanel == 1 && nextImageId) {
        const hasSegment2 = groupBubbles.some(b => b.segment_index === 2);
        if (nextImageRows.length > 0 && nextImageId && !hasSegment2) {
          const nextTop = bubble.top - canvas_height;

          // Insert continuation bubble in next panel
          await client.query(
            `
  INSERT INTO bubble (
    image_id, group_id, segment_index,
    top_ratio, left_ratio, width, height, angle,
    style,
    original_text, translated_text
  ) 
  VALUES (
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11
  )
  `,
            [
              nextImageId,
              groupId,
              2,
              nextTop,
              bubble.left,
              bubble.width,
              bubble.height,
              bubble.angle ?? 0,
              JSON.stringify(style),
              bubble.originalText ?? null,
              bubble.translatedText ?? null,
            ],
          );
        }
      }

      if (groupId) {

        const ourBubble = groupBubbles.find(b => b.id === bubble.id);
        const previousBubble = groupBubbles.find(b => b.segment_index === 1);

        const sql = `
  UPDATE bubble 
  SET 
    top_ratio = $1,
    left_ratio = $4,
    width = $5,
    height = $6,
    angle = $7,
    style = $8,
    translated_text = $9
  WHERE group_id = $2 
    AND segment_index = $3
`;
        // Top bubble ni baiwal daraagiinhaa bubble-g update
        if (ourBubble.segment_index == 1) {
          await client.query(sql, [
            bubble.top - canvas_height,
            groupId,
            2,
            bubble.left,
            bubble.width,
            bubble.height,
            bubble.angle,
            JSON.stringify(style),
            bubble.translatedText,
          ]);
          await redisDelete(IMAGE_DETAIL_PREFIX + nextImageId);
        }
        // Bottom bubble ni baiwal deed bubble-g update
        else if (ourBubble.segment_index == 2 && previousBubble) {
          const { rows: prevImageRows } = await client.query(
            `
          SELECT canvas_height
          FROM episode_images
          where id = $1
          `,
            [previousBubble.image_id],
          );

          await client.query(sql, [
            bubble.top + Number(prevImageRows[0].canvas_height),
            groupId,
            1,
            bubble.left,
            bubble.width,
            bubble.height,
            bubble.angle,
            JSON.stringify(style),
            bubble.translatedText,
          ]);
          await redisDelete(IMAGE_DETAIL_PREFIX + previousBubble.image_id);
        }
      }

      await redisDelete(IMAGE_DETAIL_PREFIX + nextImageId);

    }

    await client.query("COMMIT");
    await redisDelete(IMAGE_DETAIL_PREFIX + imageId);

    // delete old file safely
    if (oldImageUrl) {
      await deleteMany([oldImageUrl]);
    }
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function updateEpisodeCleaned(
  episodeId: number,
  cleanedImageUrl: string,
) {
  const { rows } = await pool.query(
    "select cleaned_image_url from episode_images where id = $1",
    [episodeId],
  );

  if (rows.length > 0 && rows[0].cleaned_image_url) {
    await deleteMany([rows[0].cleaned_image_url]);
  }

  await pool.query(
    "UPDATE episode_images SET cleaned_image_url = $1 WHERE id = $2",
    [cleanedImageUrl, episodeId],
  );


  const cacheKey = IMAGE_DETAIL_PREFIX + episodeId;
  await redisDelete(cacheKey);

  return CDN_URL + cleanedImageUrl;
}

export async function getStylePresets(user: DecodedIdToken) {
  const { rows } = await pool.query(
    "SELECT * FROM style_presets WHERE user_id = (SELECT id FROM users WHERE firebase_uid = $1)",
    [user.uid],
  );
  return rows;
}

export async function saveStylePreset(
  user: DecodedIdToken,
  name: string,
  style: any,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      "INSERT INTO style_presets (user_id, name, style) VALUES ((SELECT id FROM users WHERE firebase_uid = $1), $2, $3) RETURNING *",
      [user.uid, name, JSON.stringify(style)],
    );
    await client.query("COMMIT");
    return rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function deleteStylePreset(
  user: DecodedIdToken,
  id: string
) {
  const userInfo = await getUserByFirebaseUid(user.uid);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "DELETE FROM style_presets where id = $1 and user_id = $2",
      [id, userInfo.id],
    );
    await client.query("COMMIT");
    return { success: true }
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function aiTranslateEpisode(webtoonId: number, episodeId: number, user: DecodedIdToken) {
  await checkTranslatorAssignment(user, webtoonId);

  const { rows: episodeRows } = await pool.query(`select translation_status, status from webtoon_episodes where id = $1`, [episodeId]);

  if (episodeRows[0].translation_status && episodeRows[0].translation_status === 'TRANSLATED') {
    throw new Error('Энэ ангийг AI-р орчуулсан байна.');
  }

  if (episodeRows[0].status && episodeRows[0].status === PUBLISHED) {
    throw new Error('Энэ ангийг PUBLISH хийсэн байна.');
  }

  const { rows: bubbles } = await pool.query(
    `SELECT b.id, b.original_text, b.image_id
      FROM bubble b
      JOIN episode_images ei ON b.image_id = ei.id
      WHERE ei.episode_id = $1
      ORDER BY b.image_id`, [episodeId]
  );

  const chunks = chunkArray(bubbles, 30);
  const limit = pLimit(5); // max 5 concurrent

  const results = await Promise.all(
    chunks.map((chunk) =>
      limit(() => translateBubbles(JSON.stringify(chunk)))
    )
  );

  const allTranslations = results.flat();
  await updateBubbles(allTranslations);
  await pool.query(`update webtoon_episodes set translation_status = 'TRANSLATED' where id = $1`, [episodeId]);
}

async function updateBubbles(translations: { id: string, translated: string }[]) {
  if (translations.length === 0) return;

  // Build a VALUES string for PostgreSQL
  const values = translations
    .map((t, i) => `($${i * 2 + 1}, $${i * 2 + 2})`)
    .join(", ");

  // Flatten the array of values for query parameters
  const params = translations.flatMap(t => [t.id, t.translated]);

  const query = `
    UPDATE bubble AS b
    SET translated_text = v.translated
    FROM (VALUES ${values}) AS v(id, translated)
    WHERE b.id = v.id::uuid
  `;

  await pool.query(query, params);
  console.log(`Updated ${translations.length} bubbles`);
}

function chunkArray<T>(array: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}