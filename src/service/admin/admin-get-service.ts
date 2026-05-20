import { CDN_URL } from "../../const/url-const";
import { pool } from "../../database";
import { redisDelete, redisSet, redisGet } from "../../database/redis";
import { ONE_HOUR, ROLE_LIST, TRANSLATOR_WEBTOON_PREFIX, TWENTY_FOUR_HOURS, WEBTOON_DETAIL_PREFIX, WEBTOON_LIST } from "../../const/redis-const";

export async function getWebtoonList() {
  const cached = await redisGet(WEBTOON_LIST);
  if (cached) {
    return JSON.parse(cached);
  }

  const { rows } = await pool.query(
    `
    SELECT id, title, cover_url, created_at
    FROM webtoons
    ORDER BY created_at DESC
    LIMIT 50
    `,
  );

  const result = rows.map((row) => ({
    ...row,
    cover_url: CDN_URL + row.cover_url,
  }));

  await redisSet(WEBTOON_LIST, JSON.stringify(result), ONE_HOUR); // 1 hour
  return result;
}

export async function detailWithEpisodes(webtoonId: number) {
  const cacheKey = WEBTOON_DETAIL_PREFIX + webtoonId;
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
          'status', e.status
        )
        ORDER BY e.episode_number DESC
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

  await redisSet(cacheKey, JSON.stringify(webtoon), ONE_HOUR); // 1 hour
  return webtoon;
}

export async function getUserList(
  email?: string,
  role?: string,
  limit = 50,
  offset = 0
) {
  const values: any[] = [];
  const conditions: string[] = [];

  if (email) {
    values.push(`%${email}%`);
    conditions.push(`u.email ILIKE $${values.length}`);
  }

  if (role) {
    values.push(role);
    conditions.push(`
      EXISTS (
        SELECT 1
        FROM user_roles ur2
        JOIN roles r2 ON r2.id = ur2.role_id
        WHERE ur2.user_id = u.id
          AND r2.name = $${values.length}
      )
    `);
  }

  const whereClause = conditions.length
    ? `WHERE ${conditions.join(" AND ")}`
    : "";

  const query = `
    SELECT
      u.id,
      u.nickname,
      u.email,
      u.created_at,
      u.sub_start_date,
      u.sub_end_date,
      COALESCE(
        array_agg(r.name) FILTER (WHERE r.name IS NOT NULL),
        '{}'
      ) AS roles
    FROM users u
    LEFT JOIN user_roles ur ON ur.user_id = u.id
    LEFT JOIN roles r ON r.id = ur.role_id
    ${whereClause}
    GROUP BY u.id
    ORDER BY u.created_at DESC
    LIMIT $${values.length + 1}
    OFFSET $${values.length + 2}
  `;

  values.push(limit, offset);
  const { rows } = await pool.query(query, values);
  return rows;
}

export async function getTranslatorAssignedWebtoons(translatorId: number) {
  const cacheKey = TRANSLATOR_WEBTOON_PREFIX + translatorId;
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
      w.created_at
    FROM translator_webtoons ta
    JOIN webtoons w ON w.id = ta.webtoon_id
    WHERE ta.translator_id = $1
    ORDER BY w.created_at DESC
    LIMIT 100
    `,
    [translatorId]
  );

  const result = rows.map((row) => ({
    ...row,
    cover_url: CDN_URL + row.cover_url,
  }));

  await redisSet(cacheKey, JSON.stringify(result), ONE_HOUR); // 1 hour
  return result;
}

export async function getRoles() {

  const cached = await redisGet(ROLE_LIST);
  if (cached) {
    return JSON.parse(cached);
  }

  const { rows } = await pool.query(
    `
    SELECT *
    FROM roles
    ORDER BY id ASC
    `,
  );

  await redisSet(ROLE_LIST, JSON.stringify(rows), TWENTY_FOUR_HOURS);
  return rows;
}
