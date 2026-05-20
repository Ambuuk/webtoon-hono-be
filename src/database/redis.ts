import { Redis } from "@upstash/redis";

function getRedis(): Redis | null {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
}

let _redis: Redis | null | undefined;

function redis(): Redis | null {
  if (_redis === undefined) {
    _redis = getRedis();
  }
  return _redis;
}

export async function redisDelete(key: string) {
  await redis()?.del(key);
}

export async function redisSet(key: string, value: string, expireSeconds?: number) {
  const r = redis();
  if (!r) return;
  if (expireSeconds) {
    await r.set(key, value, { ex: expireSeconds });
  } else {
    await r.set(key, value);
  }
}

export async function redisGet(key: string): Promise<string | null> {
  return (await redis()?.get<string>(key)) ?? null;
}
