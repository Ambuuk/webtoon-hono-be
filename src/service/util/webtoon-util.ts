import { WEBTOON_DETAIL_ONLY_PREFIX } from "../../const/redis-const";
import { redisDelete, redisSet, redisGet } from "../../database/redis";
import { pool } from "../../database";
import { CDN_URL } from "../../const/url-const";

export async function getWebtoonDetail(webtoonId: string) {
    const cacheKey = WEBTOON_DETAIL_ONLY_PREFIX + webtoonId;
    const cached = await redisGet(cacheKey);
    if (cached) {
        return JSON.parse(cached);
    }

    const { rows } = await pool.query("SELECT * FROM webtoons WHERE id = $1", [webtoonId]);

    if (rows.length === 0) {
        throw new Error("Webtoon not found with id: " + webtoonId);
    }

    const detail = rows[0];
    detail.cover_url = CDN_URL + detail.cover_url;
    await redisSet(cacheKey, JSON.stringify(detail), 60 * 60 * 24 * 1);
    return detail;
}