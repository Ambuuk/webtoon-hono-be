import { EPISODE_IMAGES_PREFIX } from "../../const/redis-const";
import { pool } from "../../database";
import { redisDelete } from "../../database/redis";
import { checkAdminRole } from "../admin/admin-service";
import type { DecodedIdToken } from "../../types/firebase";

export async function report(imageId: number, description: string, user: DecodedIdToken) {
    const isMod = await checkAdminRole(user, "MODERATOR");
    if (!isMod) {
        throw new Error("Unauthorized");
    }
    const result = await pool.query(
        "update episode_images set status = 'REPORTED', status_desc = $1 where id = $2 returning episode_id",
        [description, imageId],
    );

    const episodeId = result.rows[0].episode_id
    const webtoonResult = await pool.query("select webtoon_id, episode_number from webtoon_episodes where id = $1", [episodeId]);
    const cacheKey = EPISODE_IMAGES_PREFIX + `${webtoonResult.rows[0].webtoon_id}:${webtoonResult.rows[0].episode_number}`;
    await redisDelete(cacheKey);
    
};