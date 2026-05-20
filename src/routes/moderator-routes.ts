import { Hono } from "hono";
import type { Variables } from "../index";
import { MODERATOR_ROLE } from "../const/webtoon-status-const";
import { checkAdminRole } from "../service/admin/admin-service";
import { report } from "../service/moderator/moderator-service";

const app = new Hono<{ Variables: Variables }>();

app.post("/report", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const isMod = await checkAdminRole(user, MODERATOR_ROLE);
  if (!isMod) return c.json({ error: "Forbidden" }, 403);

  const { imageId, description } = await c.req.json();
  await report(imageId, description, user);
  return c.json({ status: "OK" });
});

export default app;
