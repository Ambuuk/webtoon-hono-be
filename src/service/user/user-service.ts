import type { DecodedIdToken } from "../../types/firebase";
import { ONE_HOUR, USER_DETAIL_PREFIX } from "../../const/redis-const";
import { CDN_URL } from "../../const/url-const";
import { PUBLISHED, TranslationStatus, TranslationStatusLabel } from "../../const/webtoon-status-const";
import { pool } from "../../database";
import { redisDelete, redisGet, redisSet } from "../../database/redis";
import { checkAdminRole } from "../admin/admin-service";
import { checkTranslatorAssignment } from "../util/user-util";

// Deploy

export async function getUserById(user: DecodedIdToken) {
  const firebase_uid = user.user_id;
  const userEmail = user.email || "";

  const cacheKey = USER_DETAIL_PREFIX + firebase_uid;
  // const cached = await redisGet(cacheKey);
  // if (cached) {
  //   return JSON.parse(cached);
  // }

  const { rows: userRows } = await pool.query(
    `
    INSERT INTO users (firebase_uid, email, last_login_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (firebase_uid)
    DO UPDATE SET last_login_at = NOW()
    RETURNING *
    `,
    [firebase_uid, userEmail],
  );

  const userResult = userRows[0];

  const { rows } = await pool.query(
    `
    SELECT 
      u.id,
      u.avatar_id,
      a.key AS avatar_key,
      COALESCE(
        json_agg(r.*) FILTER (WHERE r.id IS NOT NULL),
        '[]'
      ) AS roles
    FROM users u
    LEFT JOIN user_roles ur ON ur.user_id = u.id
    LEFT JOIN roles r ON r.id = ur.role_id
    LEFT JOIN avatars a ON a.id = u.avatar_id
    WHERE u.id = $1
    GROUP BY u.id, a.key
    `,
    [userResult.id],
  );

  const fullUser = {
    ...userResult,
    roles: rows[0].roles,
    avatar_url: rows[0].avatar_key ? CDN_URL + rows[0].avatar_key : null,
    bolomjtoi: 0
  };

  // No caching
  if (fullUser.bolomjtoi == 0) {
    return fullUser;
  }

  await redisSet(cacheKey, JSON.stringify(fullUser), ONE_HOUR); // 1 hour
  return fullUser;
}

export async function createUser(firebaseUid: string, email: string) {
  const { rows } = await pool.query(
    "INSERT INTO users (firebase_uid, email) VALUES ($1, $2) RETURNING *",
    [firebaseUid, email],
  );
  return rows[0];
}

export async function getNewWebtoons() {
  const { rows } = await pool.query(
    "SELECT * FROM webtoons ORDER BY created_at DESC LIMIT 10",
  );

  for (const row of rows) {
    row.coverUrl = "https://cdn.hmanhwa.xyz/" + row.cover_url;
  }

  return rows;
}

export async function getLatestWebtoons() {
  const sql = `SELECT w.*,
      MAX(e.modified_at) AS last_episode_modified
      FROM webtoons w
      LEFT JOIN webtoon_episodes e
        ON e.webtoon_id = w.id
        AND e.status = $1
      WHERE w.status = $1
      GROUP BY w.id
      ORDER BY last_episode_modified DESC NULLS LAST;
      `;
  const { rows } = await pool.query(sql, [PUBLISHED]);

  for (const row of rows) {
    row.cover_url = CDN_URL + row.cover_url;

    const result = await pool.query(
      "SELECT * FROM webtoon_episodes WHERE webtoon_id = $1 AND status = $2 ORDER BY episode_number DESC LIMIT 5",
      [row.id, PUBLISHED],
    );

    const freeEpisodes = await pool.query(
      "SELECT * FROM webtoon_episodes WHERE webtoon_id = $1 AND status = $2 and sub_required = 0",
      [row.id, PUBLISHED],
    );

    const latestEpisodes = result.rows;
    row.latestEpisodes = latestEpisodes;
    row.freeEpisodesCount = freeEpisodes.rows.length;
    row.translation_status = TranslationStatusLabel[row.translation_status as TranslationStatus];
  }

  return rows;
}

export async function getWebtoonDetail(
  webtoonId: string,
  user: DecodedIdToken | undefined,
) {
  const { rows } = await pool.query("SELECT * FROM webtoons WHERE id = $1", [
    webtoonId,
  ]);
  const webtoon = rows[0];
  if (webtoon) {
    webtoon.cover_url = "https://cdn.hmanhwa.xyz/" + webtoon.cover_url;
  }

  if (user) {
    const sql = `SELECT
    ep.*,
    ure.read_at
FROM webtoon_episodes ep
LEFT JOIN users u
    ON u.firebase_uid = $3
LEFT JOIN (
    SELECT episode_id, user_id, MAX(read_at) AS read_at
    FROM user_read_episodes
    GROUP BY episode_id, user_id
) ure
    ON ure.episode_id = ep.id
    AND ure.user_id = u.id
WHERE
    ep.webtoon_id = $1
    AND ep.status = $2
ORDER BY
    ep.episode_number DESC;`;
    const episodesResult = await pool.query(sql, [
      webtoonId,
      PUBLISHED,
      user.uid,
    ]);

    webtoon.episodes = episodesResult.rows;
  } else {
    const episodesResult = await pool.query(
      "SELECT * FROM webtoon_episodes epd WHERE webtoon_id = $1 AND status = $2 ORDER BY episode_number desc",
      [webtoonId, PUBLISHED],
    );

    webtoon.episodes = episodesResult.rows;
  }

  return webtoon;
}

export async function readChapter(
  webtoonId: string,
  episodeId: string,
  userId: string,
  userAdmin: DecodedIdToken,
) {
  const { rows } = await pool.query(
    "SELECT * FROM users WHERE firebase_uid = $1",
    [userId],
  );

  if (rows.length === 0) {
    throw new Error("User not found");
  }

  const user = rows[0];
  const webtoon = await getWebtoon(webtoonId);
  if (!webtoon) {
    throw new Error("Webtoon not found");
  }

  await pool.query(
    "update webtoons set total_views = total_views + 1 where id = $1",
    [webtoonId],
  );

  const episodes = await pool.query(
    "SELECT * FROM webtoon_episodes WHERE webtoon_id = $1",
    [webtoonId],
  );

  const episodeCount = await pool.query(
    "SELECT * FROM webtoon_episodes WHERE webtoon_id = $1 and status = $2",
    [webtoonId, PUBLISHED],
  );

  webtoon.episodeCount = episodeCount.rows.length;

  const currentEpisode = episodes.rows.find(
    (episode) => episode.episode_number === Number(episodeId),
  );

  const isTranslator = await checkAdminRole(userAdmin, "TRANSLATOR");

  if (currentEpisode.status !== "PUBLISHED" && !isTranslator) {
    throw Error("Гаргаагүй анги байна");
  }

  let checkSub = true;
  if (currentEpisode.status !== "PUBLISHED" && isTranslator) {
    checkTranslatorAssignment(userAdmin, Number(webtoonId));
    checkSub = false;
  }

  if (currentEpisode.sub_required == 1 && checkSub) {
    if (!user.sub_end_date) {
      return { access: false, message: "No active subscription" };
    }

    if (new Date(user.sub_end_date) < new Date()) {
      return { access: false, message: "Subscription expired" };
    }
  }

  const images = await pool.query(
    "SELECT id, image_url, edited_image_url, cleaned_image_url, order_no FROM episode_images WHERE episode_id = $1 order by id",
    [currentEpisode.id],
  );

  for (const img of images.rows) {
    if (img.edited_image_url != null) {
      img.edited_image_url = "https://cdn.hmanhwa.xyz/" + img.edited_image_url;
      continue;
    }

    if (img.image_url != null) {
      img.image_url = "https://cdn.hmanhwa.xyz/" + img.image_url;
    }
  }

  webtoon.episodeImages = images.rows;
  const read_at = new Date();

  await pool.query(
    `INSERT INTO user_read_episodes (user_id, episode_id, read_at)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id, episode_id, read_at) DO NOTHING;`,
    [user.id, currentEpisode.id, read_at],
  );

  webtoon.currentEpisodeId = currentEpisode.id;

  return webtoon;
}

export async function getAvatars() {
  const { rows } = await pool.query("SELECT * FROM avatars");

  for (const row of rows) {
    row.url = "https://cdn.hmanhwa.xyz/" + row.key;
  }

  return rows;
}

export async function updateAvatar(
  user: DecodedIdToken,
  id: number,
) {
  await pool.query("UPDATE users SET avatar_id = $1 WHERE firebase_uid = $2", [
    id,
    user.uid,
  ]);
}

export async function updateNickname(
  user: DecodedIdToken,
  nickname: String,
) {
  await pool.query("UPDATE users SET nickname = $1 WHERE firebase_uid = $2", [
    nickname,
    user.uid,
  ]);
}

export async function getUserLatestRead(user: DecodedIdToken) {
  const sql = `SELECT DISTINCT ON (w.id)
      w.id,
      w.title,
      w.cover_url,
      c.episode_number,
      ucr.read_at AS last_read_at
    FROM user_read_episodes ucr
    JOIN users ur on ur.id = ucr.user_id
    JOIN webtoon_episodes c ON c.id = ucr.episode_id
    JOIN webtoons w ON w.id = c.webtoon_id
    WHERE ur.firebase_uid = $1
    ORDER BY
      w.id,
    ucr.read_at DESC;`;

  const result = await pool.query(sql, [user.uid]);

  for (const row of result.rows) {
    row.cover_url = "https://cdn.hmanhwa.xyz/" + row.cover_url;
  }

  return result.rows;
}

async function getWebtoon(webtoonId: string) {
  const { rows } = await pool.query("SELECT * FROM webtoons WHERE id = $1", [
    webtoonId,
  ]);
  return rows[0];
}

export async function searchWebtoon(searchStr: string) {
  const { rows } = await pool.query(`SELECT
    id,
    title,
    cover_url,
    total_views,
    ts_rank(search_vector, plainto_tsquery('simple', unaccent(lower($1)))) AS rank,
    similarity(title, $1) AS sim
FROM webtoon.webtoons
WHERE
    search_vector @@ plainto_tsquery('simple', unaccent(lower($1)))
    OR title % $1
ORDER BY
    (ts_rank(search_vector, plainto_tsquery('simple', unaccent(lower($1)))) * 0.7
     + similarity(title, $1) * 0.3) DESC,
    total_views DESC
LIMIT 20;`, [searchStr]);

  rows.forEach((row) => row.cover_url = CDN_URL + row.cover_url);

  return rows;
}

export async function getVideos() {
  const { rows } = await pool.query("SELECT * FROM videos LIMIT 10");
  rows.forEach((row) => row.video_url = "https://videodelivery.net/" + row.stream_uid + "/manifest/video.m3u8");
  return rows;
}

export async function deleteAccount(user: DecodedIdToken) {
  const { rows } = await pool.query(
    "SELECT * FROM users WHERE firebase_uid = $1",
    [user.uid],
  );
  if (rows.length === 0) {
    throw new Error("User not found");
  }
  const userData = rows[0];

  await pool.query("DELETE FROM user_read_episodes WHERE user_id = $1", [userData.id]);
  await pool.query("DELETE FROM users WHERE firebase_uid = $1", [user.uid]);
  await redisDelete(USER_DETAIL_PREFIX + user.uid);
  return userData;
}

export async function getLatestComments() {
  const { rows } = await pool.query(`select * from vw_latest_comments_list order by id desc limit 10;`);
  for (const row of rows) {
    row.avatar_url = row.avatar_key ? CDN_URL + row.avatar_key : null;
    row.thumbnail_url = row.thumbnail_url ? CDN_URL + row.thumbnail_url : null;
  }
  return rows;
}

export async function saveToken(user: DecodedIdToken, token: string) {
  await pool.query("update users set fcm_token = $1 where firebase_uid = $2", [token, user.uid]);
}