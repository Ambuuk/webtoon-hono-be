import { Hono } from "hono";
import type { Variables } from "../index";
import type { DecodedIdToken } from "../types/firebase";
import { MODERATOR_ROLE } from "../const/webtoon-status-const";
import {
  detailWithEpisodes,
  getRoles,
  getTranslatorAssignedWebtoons,
  getUserList,
  getWebtoonList,
} from "../service/admin/admin-get-service";
import {
  addWebtoon,
  assignTranslatorWebtoon,
  checkAdminRole,
  cleanEpisode,
  deleteEpisode,
  deleteWebtoon,
  insertAvatar,
  insertEpisode,
  updateEpisodeStatus,
  updateUserRoles,
  updateVideo,
  updateWebtoonStatus,
  uploadVideo,
} from "../service/admin/admin-service";
import { ocrEpisode } from "../service/ocr/ocr-service";
import { generateVideoUploadUrl } from "../service/s3/cloudflare-stream";
import { generateUploadUrl } from "../service/s3/s3-client";

const app = new Hono<{ Variables: Variables }>();

async function requireAdmin(user: DecodedIdToken | undefined, c: any) {
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const ok = await checkAdminRole(user, "ADMIN");
  if (!ok) return c.json({ error: "Forbidden" }, 403);
  return null;
}

async function requireMod(user: DecodedIdToken | undefined, c: any) {
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const ok = await checkAdminRole(user, MODERATOR_ROLE);
  if (!ok) return c.json({ error: "Forbidden" }, 403);
  return null;
}

app.post("/updateEpisodeStatus", async (c) => {
  const denied = await requireMod(c.get("user"), c);
  if (denied) return denied;
  const { episodeId, status } = await c.req.json();
  await updateEpisodeStatus(episodeId, status);
  return c.json({ success: true });
});

app.post("/updateWebtoonStatus", async (c) => {
  const denied = await requireAdmin(c.get("user"), c);
  if (denied) return denied;
  const { webtoonId, status } = await c.req.json();
  await updateWebtoonStatus(webtoonId, status);
  return c.json({ success: true });
});

app.post("/deleteEpisode", async (c) => {
  const denied = await requireAdmin(c.get("user"), c);
  if (denied) return denied;
  const { episodeId } = await c.req.json();
  await deleteEpisode(episodeId);
  return c.json({ success: true });
});

app.post("/cleanEpisode", async (c) => {
  const denied = await requireAdmin(c.get("user"), c);
  if (denied) return denied;
  const { episodeId } = await c.req.json();
  await cleanEpisode(episodeId);
  return c.json({ success: true });
});

app.post("/insertEpisode", async (c) => {
  const denied = await requireAdmin(c.get("user"), c);
  if (denied) return denied;
  const { webtoonId, episodeNumber } = await c.req.json();
  const episodeId = await insertEpisode(webtoonId, episodeNumber);
  return c.json({ success: true, episodeId });
});

app.post("/uploadImage", async (c) => {
  const denied = await requireAdmin(c.get("user"), c);
  if (denied) return denied;
  const { key } = await c.req.json();
  const result = await generateUploadUrl(key);
  return c.json(result);
});

app.post("/deleteWebtoon", async (c) => {
  const denied = await requireAdmin(c.get("user"), c);
  if (denied) return denied;
  const { id } = await c.req.json();
  await deleteWebtoon(id);
  return c.json({ success: true });
});

app.post("/addWebtoon", async (c) => {
  const denied = await requireAdmin(c.get("user"), c);
  if (denied) return denied;
  const { title, summary, coverUrl } = await c.req.json();
  await addWebtoon(title, summary, coverUrl);
  return c.json({ success: true });
});

app.post("/getWebtoonList", async (c) => {
  const denied = await requireMod(c.get("user"), c);
  if (denied) return denied;
  const webtoons = await getWebtoonList();
  return c.json(webtoons);
});

app.post("/detailWithEpisodes", async (c) => {
  const denied = await requireMod(c.get("user"), c);
  if (denied) return denied;
  const { id } = await c.req.json();
  const result = await detailWithEpisodes(id);
  return c.json(result);
});

app.post("/insertAvatar", async (c) => {
  const denied = await requireAdmin(c.get("user"), c);
  if (denied) return denied;
  const { name, key } = await c.req.json();
  await insertAvatar(name, key);
  return c.json({ success: true });
});

app.post("/updateVideo", async (c) => {
  const denied = await requireAdmin(c.get("user"), c);
  if (denied) return denied;
  const { uid, playback_url } = await c.req.json();
  await updateVideo(playback_url, uid);
  return c.json({ success: true });
});

app.post("/getUserList", async (c) => {
  const denied = await requireAdmin(c.get("user"), c);
  if (denied) return denied;
  const { email, role } = await c.req.json();
  const users = await getUserList(email, role);
  return c.json(users);
});

app.get("/getRoles", async (c) => {
  const denied = await requireAdmin(c.get("user"), c);
  if (denied) return denied;
  const roles = await getRoles();
  return c.json(roles);
});

app.post("/updateUserRoles", async (c) => {
  const denied = await requireAdmin(c.get("user"), c);
  if (denied) return denied;
  const { userId, roleIds } = await c.req.json();
  await updateUserRoles(userId, roleIds);
  return c.json({ success: true });
});

app.post("/getTranslatorAssignedWebtoons", async (c) => {
  const denied = await requireAdmin(c.get("user"), c);
  if (denied) return denied;
  const { translatorId } = await c.req.json();
  const webtoons = await getTranslatorAssignedWebtoons(translatorId);
  return c.json(webtoons);
});

app.post("/ocrEpisode", async (c) => {
  const denied = await requireAdmin(c.get("user"), c);
  if (denied) return denied;
  const { episodeId } = await c.req.json();
  const result = await ocrEpisode(episodeId);
  return c.json(result);
});

app.post("/assignTranslatorWebtoon", async (c) => {
  const denied = await requireAdmin(c.get("user"), c);
  if (denied) return denied;
  const { translatorId, webtoonIds } = await c.req.json();
  await assignTranslatorWebtoon(translatorId, webtoonIds);
  return c.json({ success: true });
});

app.get("/generateVideoUploadUrl", async (c) => {
  const title = c.req.query("title");
  const description = c.req.query("description");
  if (!title || !description) {
    return c.json({ error: "Wrong params" }, 403);
  }
  const result = await generateVideoUploadUrl(String(title), String(description));
  return c.json(result);
});

export default app;
