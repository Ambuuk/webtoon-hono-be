import { pool } from "../../database";

export async function createComment(
  uid: string,
  targetType: string,
  targetId: number,
  commentBody: string,
  parentId?: number,
) {
  const userList = await pool.query(
    "SELECT * FROM users WHERE firebase_uid = $1",
    [uid],
  );
  const userInfo = userList.rows[0];

  const result = await pool.query(
    `
      INSERT INTO comments (user_id, target_type, target_id, comment_body, parent_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *;
      `,
    [userInfo.id, targetType, targetId, commentBody, parentId || null],
  );

  return result.rows[0];
}

export async function getComments(
  targetType: string,
  targetId: number,
  limit: number = 20,
  cursor?: number,
) {
  const result = await pool.query(
    `
      SELECT c.*, 
        u.nickname
      FROM comments c
      JOIN users u ON u.id = c.user_id
      WHERE c.target_type = $1
        AND c.target_id = $2
        AND c.parent_id IS NULL
        ${cursor ? "AND c.id < $4" : ""}
      ORDER BY c.id DESC
      LIMIT $3;
      `,
    cursor
      ? [targetType, targetId, limit, cursor]
      : [targetType, targetId, limit],
  );

  for (const row of result.rows) {
    const userResult = await pool.query(
      `select cl.comment_id, cl.user_id, u.nickname  from comment_likes cl inner join users u on cl.user_id = u.id where cl.comment_id = $1`,
      [row.id],
    );
    row.liked_users = userResult.rows;

    const replies = await pool.query(`
      SELECT c.*, 
        u.nickname
      FROM comments c
      JOIN users u ON u.id = c.user_id
      WHERE c.target_type = $1
        AND c.target_id = $2
        AND c.parent_id = $3
      ORDER BY c.id DESC;
      `, [targetType, targetId, row.id])

    row.replies = replies.rows;

  }

  return result.rows;
}

export async function getReplies(commentId: number) {
  const result = await pool.query(
    `
      SELECT c.*, u.nickname
      FROM comments c
      JOIN users u ON u.id = c.user_id
      WHERE c.parent_id = $1
      ORDER BY c.created_at ASC;
      `,
    [commentId],
  );

  return result.rows;
}

export async function toggleCommentLike(uid: string, commentId: number) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const userList = await pool.query(
      "SELECT * FROM users WHERE firebase_uid = $1",
      [uid],
    );
    const userInfo = userList.rows[0];

    // Try inserting like
    const insertResult = await client.query(
      `
      INSERT INTO comment_likes (user_id, comment_id)
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING
      RETURNING *;
      `,
      [userInfo.id, commentId],
    );

    let liked: boolean;

    if (insertResult.rowCount === 1) {
      // Like inserted
      liked = true;
    } else {
      // Already liked → remove it
      await client.query(
        `
        DELETE FROM comment_likes
        WHERE user_id = $1 AND comment_id = $2;
        `,
        [userInfo.id, commentId],
      );

      liked = false;
    }

    await client.query("COMMIT");

    return { liked };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
