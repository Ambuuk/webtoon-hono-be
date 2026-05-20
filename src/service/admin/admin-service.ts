import type { DecodedIdToken } from "../../types/firebase";
import {
  TRANSLATOR_ASSIGN_PREFIX,
  TRANSLATOR_WEBTOON_PREFIX,
  TWENTY_FOUR_HOURS,
  USER_DETAIL_PREFIX,
  WEBTOON_DETAIL_PREFIX,
  WEBTOON_LIST,
} from "../../const/redis-const";
import { NEW, PUBLISHED } from "../../const/webtoon-status-const";
import { pool } from "../../database";
import { redisDelete, redisSet } from "../../database/redis";
import { deleteMany } from "../s3/s3-client";
import { getUserById } from "../util/user-util";

export async function updateEpisodeStatus(episodeId: number, status: string) {
  const result = await pool.query(
    "UPDATE webtoon_episodes set status = $1, modified_at = NOW() WHERE id = $2 returning webtoon_id",
    [status, episodeId],
  );

  if (result.rowCount === 0) {
    throw new Error("Episode not found");
  }
  await redisDelete(WEBTOON_DETAIL_PREFIX + result.rows[0].webtoon_id);
}

export async function updateWebtoonStatus(webtoonId: number, status: string) {
  await pool.query("UPDATE webtoons SET status = $1 WHERE id = $2", [
    status,
    webtoonId,
  ]);
  await Promise.all([
    redisDelete(WEBTOON_LIST),
    redisDelete(WEBTOON_DETAIL_PREFIX + webtoonId),
  ]);
}

export async function insertEpisode(webtoonId: number, episodeNumber: number) {
  const result = await pool.query(
    "INSERT INTO webtoon_episodes (webtoon_id, episode_number, sub_required, status, modified_at) VALUES ($1, $2, $3, $4, NOW()) RETURNING *",
    [webtoonId, episodeNumber, 1, NEW],
  );
  const episodeId = result.rows[0].id;
  await redisDelete(WEBTOON_DETAIL_PREFIX + webtoonId);
  return episodeId;
}

export async function deleteEpisode(episodeId: number) {
  const { rows } = await pool.query(
    "select * from webtoon_episodes where id = $1",
    [episodeId],
  );

  if (rows[0].status === PUBLISHED) {
    throw new Error("Can't delete PUBLISHED episode.");
  }

  const { rows: imageRows } = await pool.query(
    "select * from episode_images where episode_id = $1",
    [episodeId],
  );

  const keys: string[] = [];
  for (const row of imageRows) {
    if (row.image_url) {
      keys.push(row.image_url);
    }
    if (row.cleaned_image_url) {
      keys.push(row.cleaned_image_url);
    }
    if (row.edited_image_url) {
      keys.push(row.edited_image_url);
    }
  }

  if (keys.length > 0) {
    await deleteMany(keys);
  }

  await pool.query("delete from user_read_episodes where episode_id = $1", [
    episodeId,
  ]);
  await pool.query("DELETE FROM webtoon_episodes WHERE id = $1", [episodeId]);
}

export async function cleanEpisode(episodeId: number) {
  const { rows } = await pool.query(
    "select * from webtoon_episodes where id = $1",
    [episodeId],
  );

  if (!rows.length) {
    throw new Error("Episode not found");
  }

  if (rows[0].status !== PUBLISHED) {
    throw new Error("Can't clean non PUBLISHED episode.");
  }

  const episodeImages = await pool.query(
    "select * from episode_images where episode_id = $1",
    [episodeId],
  );
  const keys: string[] = [];

  for (const row of episodeImages.rows) {
    // Edited image baihgui bol butsah
    if (!row.edited_image_url) {
      continue;
    }

    if (row.image_url) {
      keys.push(row.image_url);
    }
    if (row.cleaned_image_url) {
      keys.push(row.cleaned_image_url);
    }
  }

  if (keys.length) {
    await deleteMany(keys);
  }
  await pool.query(
    `UPDATE episode_images
   SET image_url = NULL,
       cleaned_image_url = NULL
   WHERE episode_id = $1
     AND edited_image_url IS NOT NULL`,
    [episodeId],
  );

  await pool.query(
    "delete from bubble where image_id in (select id from episode_images where episode_id = $1)",
    [episodeId],
  );
  await pool.query(
    "update episode_images set other_objects = null where episode_id = $1",
    [episodeId],
  );
  await pool.query("update webtoon_episodes set clean_status = $1 where id = $2", ["CLEAN", episodeId]);
}

export async function addWebtoon(
  title: string,
  summary: string,
  coverUrl: string,
) {
  const result = await pool.query(
    "INSERT INTO webtoons (title, summary, cover_url, status) VALUES ($1, $2, $3, $4) RETURNING *",
    [title, summary, coverUrl, "NEW"],
  );

  await redisDelete(WEBTOON_LIST);
  return result.rows[0];
}

export async function deleteWebtoon(webtoonId: number) {
  await pool.query("DELETE FROM webtoons WHERE id = $1", [webtoonId]);
}

export async function checkAdminRole(
  user: DecodedIdToken,
  roleName: string,
) {
  const roles = await pool.query(
    "select * from vw_user_roles where firebase_uid = $1 and name = $2",
    [user.uid, roleName],
  );
  return roles.rows.some((role) => role.name === roleName);
}

export async function insertAvatar(
  name: string,
  key: string,
  tier = "default",
) {
  const query = `
    INSERT INTO avatars (name, key, tier)
    VALUES ($1, $2, $3)
    RETURNING *
  `;

  const values = [name, key, tier];

  const { rows } = await pool.query(query, values);
  return rows[0];
}

export async function uploadVideo(
  title: string,
  description: string,
  uid: string
) {
  const query = `
    INSERT INTO videos (title, description, stream_uid)
    VALUES ($1, $2, $3)
    RETURNING *
  `;

  const values = [title, description, uid];

  const { rows } = await pool.query(query, values);
  return rows[0];
}
export async function updateVideo(
  playback_url: string,
  uid: string
) {
  const query = `
    UPDATE videos set playback_url = $1 where stream_uid = $2 returning *
  `;

  const values = [playback_url, uid];

  const { rows } = await pool.query(query, values);
  return rows[0];
}

export async function updateUserRoles(userId: number, roleIds: number[]) {
  await pool.query("DELETE FROM user_roles WHERE user_id = $1", [userId]);
  for (const roleId of roleIds) {
    await pool.query(
      "INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)",
      [userId, roleId],
    );
  }

  const { rows: userRows } = await pool.query(
    "SELECT firebase_uid FROM users WHERE id = $1",
    [userId],
  );
  if (userRows.length === 0) {
    throw new Error("User not found");
  }
  await redisDelete(USER_DETAIL_PREFIX + userRows[0].firebase_uid);
}

export async function assignTranslatorWebtoon(
  translatorId: number,
  webtoonIds: number[],
) {
  await pool.query("DELETE FROM translator_webtoons WHERE translator_id = $1", [
    translatorId,
  ]);
  for (const webtoonId of webtoonIds) {
    await pool.query(
      "INSERT INTO translator_webtoons (translator_id, webtoon_id) VALUES ($1, $2)",
      [translatorId, webtoonId],
    );
    const cacheKey = TRANSLATOR_ASSIGN_PREFIX + translatorId + ":" + webtoonId;
    await redisSet(cacheKey, "1", TWENTY_FOUR_HOURS); // 24 hours
  }

  const userInfo = await getUserById(translatorId);
  const cacheKey = TRANSLATOR_WEBTOON_PREFIX + userInfo.firebase_uid;
  await redisDelete(cacheKey);
}
