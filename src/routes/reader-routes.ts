import { Hono } from "hono";
import type { Variables } from "../index";
import { checkInvoiceById, createInvoice } from "../service/payment/payment-service";
import {
  createComment,
  getComments,
  getReplies,
  toggleCommentLike,
} from "../service/user/comment-service";
import {
  deleteAccount,
  getAvatars,
  getUserById,
  getUserLatestRead,
  readChapter,
  saveToken,
  updateAvatar,
  updateNickname,
} from "../service/user/user-service";

const app = new Hono<{ Variables: Variables }>();

app.get("/me", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ loggedIn: false }, 401);
  const result = await getUserById(user);
  return c.json(result);
});

app.post("/createInvoice", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const { price } = await c.req.json();
  const result = await createInvoice(price, user);
  return c.json(result);
});

app.post("/readChapter", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const { webtoonId, episodeId } = await c.req.json();
  const result = await readChapter(webtoonId, episodeId, user.uid, user);
  return c.json(result);
});

app.post("/checkPayment", async (c) => {
  const { invoice_id } = await c.req.json();
  try {
    await checkInvoiceById(invoice_id);
    return c.json({ success: "Payment paid" });
  } catch {
    return c.json({ error: "Payment not paid" });
  }
});

app.post("/getAvatars", async (c) => {
  const result = await getAvatars();
  return c.json(result);
});

app.post("/updateAvatar", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ loggedIn: false }, 401);
  const { id } = await c.req.json();
  await updateAvatar(user, id);
  return c.json({ success: true });
});

app.post("/updateNickname", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ loggedIn: false }, 401);
  const { nickname } = await c.req.json();
  await updateNickname(user, nickname);
  return c.json({ success: true });
});

app.post("/getUserLatestRead", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ loggedIn: false }, 401);
  const result = await getUserLatestRead(user);
  return c.json(result);
});

app.post("/toggleCommentLike", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ loggedIn: false }, 401);
  const { commentId } = await c.req.json();
  const result = await toggleCommentLike(user.uid, commentId);
  return c.json(result);
});

app.post("/createComment", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ loggedIn: false }, 401);
  const { targetType, targetId, commentBody, parentId } = await c.req.json();
  const result = await createComment(user.uid, targetType, targetId, commentBody, parentId);
  return c.json(result);
});

app.post("/getComments", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ loggedIn: false }, 401);
  const { targetType, targetId, limit, cursor } = await c.req.json();
  const result = await getComments(targetType, targetId, limit, cursor);
  return c.json(result);
});

app.post("/getReplies", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ loggedIn: false }, 401);
  const { commentId } = await c.req.json();
  const result = await getReplies(commentId);
  return c.json(result);
});

app.delete("/deleteAccount", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ loggedIn: false }, 401);
  await deleteAccount(user);
  return c.json({ success: true });
});

app.post("/sendToken", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ loggedIn: false }, 401);
  const { token } = await c.req.json();
  if (!token) return c.json({ message: "Missing token!" }, 400);
  await saveToken(user, token);
  return c.json({ success: true });
});

export default app;
