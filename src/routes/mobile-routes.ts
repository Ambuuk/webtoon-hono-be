import { Hono } from "hono";
import { getHomeList } from "../service/mobile/mobile-get-service";

const app = new Hono();

app.get("/home", async (c) => {
  try {
    const result = await getHomeList();
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return c.json({ error: message }, 500);
  }
});

export default app;
