import { pool } from "../../database";
import { CDN_URL } from "../../const/url-const";
import { redisDelete, redisSet, redisGet } from "../../database/redis";
import { MOBILE_HOME_PREFIX } from "../../const/redis-const";
import { getWebtoonDetail } from "../util/webtoon-util";
import { getLatestWebtoons } from "../user/user-service";

export async function getHomeList() {
    const cached = await redisGet(MOBILE_HOME_PREFIX);
    if (cached) {
        return JSON.parse(cached);
    }

    const { rows: webtoons } = await pool.query("SELECT * FROM WEEKLY_FEATURED");

    const featuredWebtoons = await Promise.all(
        webtoons.map(w => getWebtoonDetail(w.webtoon_id))
    );

    const { rows: trendingWeekly } = await pool.query(`SELECT webtoon_id, COUNT(*) AS read_count
            FROM vw_user_read_episodes_readers
            WHERE read_at > NOW() - INTERVAL '7 days'
            GROUP BY webtoon_id
            ORDER BY read_count desc
            limit 5;`)

    const weeklyWebtoons = await Promise.all(
        trendingWeekly.map(w => getWebtoonDetail(w.webtoon_id))
    );

    const latestWebtoons = await getLatestWebtoons();


    const result = {
        featuredWebtoons,
        weeklyWebtoons,
        latestWebtoons
    }

    await redisSet(MOBILE_HOME_PREFIX, JSON.stringify(result), 60 * 60 * 24 * 1);
    return result;

}