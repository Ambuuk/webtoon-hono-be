import type { DecodedIdToken } from "../../types/firebase";
import {
  TRANSLATOR_ASSIGN_PREFIX,
  TWENTY_FOUR_HOURS,
  USER_FIREBASE_PREFIX,
} from "../../const/redis-const";
import { pool } from "../../database";
import { redisGet, redisSet } from "../../database/redis";

export async function getUserByFirebaseUid(firebaseUid: string) {
  const cacheKey = USER_FIREBASE_PREFIX + firebaseUid;

  const cached = await redisGet(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  const { rows } = await pool.query(
    `SELECT * FROM users WHERE firebase_uid = $1 LIMIT 1`,
    [firebaseUid],
  );

  if (rows.length === 0) {
    throw new Error("User not found");
  }

  const user = rows[0];
  await redisSet(cacheKey, JSON.stringify(user), TWENTY_FOUR_HOURS);
  return user;
}

export async function getUserById(id: number) {
  const cacheKey = USER_FIREBASE_PREFIX + id;

  const cached = await redisGet(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  const { rows } = await pool.query(
    `SELECT * FROM users WHERE id = $1 LIMIT 1`,
    [id],
  );

  if (rows.length === 0) {
    throw new Error("User not found");
  }

  const user = rows[0];
  await redisSet(cacheKey, JSON.stringify(user), TWENTY_FOUR_HOURS);
  return user;
}

export async function checkTranslatorAssignment(
  user: DecodedIdToken,
  webtoonId: number,
) {
  const userInfo = await getUserByFirebaseUid(user.uid);
  const cacheKey = TRANSLATOR_ASSIGN_PREFIX + userInfo.id + ":" + webtoonId;

  // 1. Check cache
  const cached = await redisGet(cacheKey);
  if (cached !== null) {
    if (cached === "1") return;
    throw new Error("Translator not assigned to this webtoon" + cacheKey);
  }

  const { rows } = await pool.query(
    `
    SELECT 1
    FROM translator_webtoons
    WHERE translator_id = $1 AND webtoon_id = $2
    LIMIT 1
    `,
    [userInfo.id, webtoonId],
  );

  const isAssigned = rows.length > 0;

  // 3. Cache result
  await redisSet(cacheKey, isAssigned ? "1" : "0", TWENTY_FOUR_HOURS);

  if (!isAssigned) {
    throw new Error("Translator not assigned to this webtoon");
  }
}
