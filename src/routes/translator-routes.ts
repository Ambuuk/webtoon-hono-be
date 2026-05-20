import { Hono } from "hono";
import type { Variables } from "../index";
import { TRANSLATOR_ROLE } from "../const/webtoon-status-const";
import { checkAdminRole } from "../service/admin/admin-service";
import { generateUploadUrl } from "../service/s3/s3-client";
import {
  // aiTranslateEpisode,
  deleteStylePreset,
  detailWithEpisodesTranslator,
  getEpisodeImages,
  getImageDetail,
  getStylePresets,
  getWebtoonList,
  saveStylePreset,
  updateEpisodeCleaned,
  updateEpisodeImage,
} from "../service/translator/translator-service";

const app = new Hono<{ Variables: Variables }>();

async function requireTranslator(c: any) {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const ok = await checkAdminRole(user, TRANSLATOR_ROLE);
  if (!ok) return c.json({ error: "Forbidden" }, 403);
  return null;
}

app.post("/getWebtoonList", async (c) => {
  const denied = await requireTranslator(c);
  if (denied) return denied;
  const user = c.get("user")!;
  const result = await getWebtoonList(user.uid);
  return c.json(result);
});

app.post("/detailWithEpisodesTranslator", async (c) => {
  const denied = await requireTranslator(c);
  if (denied) return denied;
  const user = c.get("user")!;
  const { id } = await c.req.json();
  if (!id) return c.json({ error: "Bad Request" }, 400);
  const result = await detailWithEpisodesTranslator(user, id);
  return c.json(result);
});

app.post("/getEpisodeImages", async (c) => {
  const denied = await requireTranslator(c);
  if (denied) return denied;
  const user = c.get("user")!;
  const { webtoonId, episode_number } = await c.req.json();
  const result = await getEpisodeImages(webtoonId, episode_number, user);
  return c.json(result);
});

app.post("/getImageDetail", async (c) => {
  const denied = await requireTranslator(c);
  if (denied) return denied;
  const user = c.get("user")!;
  const { episodeId, imageId, webtoonId } = await c.req.json();
  try {
    const result = await getImageDetail(episodeId, imageId, webtoonId, user);
    return c.json(result);
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.post("/uploadImage", async (c) => {
  const denied = await requireTranslator(c);
  if (denied) return denied;
  const { key } = await c.req.json();
  const result = await generateUploadUrl(key);
  return c.json(result);
});

app.post("/updateEpisodeImage", async (c) => {
  const denied = await requireTranslator(c);
  if (denied) return denied;
  const user = c.get("user")!;
  const {
    imageId,
    editedImageUrl,
    bubbles,
    otherObjects,
    canvas_width,
    canvas_height,
  } = await c.req.json();
  await updateEpisodeImage(
    imageId,
    editedImageUrl,
    bubbles,
    otherObjects,
    canvas_width,
    canvas_height,
    user,
  );
  return c.json({ success: true });
});

app.post("/updateEpisodeCleaned", async (c) => {
  const denied = await requireTranslator(c);
  if (denied) return denied;
  const { imageId, cleanedImageUrl } = await c.req.json();
  const imageUrl = await updateEpisodeCleaned(imageId, cleanedImageUrl);
  return c.json({ cleanedImageUrl: imageUrl });
});

app.get("/getStylePresets", async (c) => {
  const denied = await requireTranslator(c);
  if (denied) return denied;
  const user = c.get("user")!;
  const result = await getStylePresets(user);
  return c.json(result);
});

app.post("/saveStylePreset", async (c) => {
  const denied = await requireTranslator(c);
  if (denied) return denied;
  const user = c.get("user")!;
  const { name, styles } = await c.req.json();
  if (!name || !styles) return c.json({ error: "Bad Request" }, 400);
  const result = await saveStylePreset(user, name, styles);
  return c.json(result);
});

app.delete("/deleteStylePreset", async (c) => {
  const denied = await requireTranslator(c);
  if (denied) return denied;
  const user = c.get("user")!;
  const id = c.req.query("id");
  if (!id) return c.json({ error: "Bad Request" }, 400);
  const result = await deleteStylePreset(user, id);
  return c.json(result);
});

// app.post("/aiTranslateEpisode", async (c) => {
//   const denied = await requireTranslator(c);
//   if (denied) return denied;
//   const user = c.get("user")!;
//   const { webtoonId, episodeId } = await c.req.json();
//   if (!webtoonId || !episodeId) return c.json({ error: "Bad Request" }, 400);
//   try {
//     await aiTranslateEpisode(webtoonId, episodeId, user);
//   } catch (error) {
//     return c.json({ message: (error as Error).message }, 500);
//   }
//   return c.json({ success: true });
// });

export default app;
