import { Hono } from "hono";
import type { Variables } from "../index";
import { splitAndUploadToR2 } from "../service/s3/upload-service";

const app = new Hono<{ Variables: Variables }>();

app.post("/uploadPanels", async (c) => {
  try {
    const body = await c.req.parseBody();
    const file = body["image"];

    if (!file || typeof file === "string") {
      return c.json({ success: false, error: "No image uploaded" }, 400);
    }

    const episodeId = body["episodeId"];
    const arrayBuffer = await (file as File).arrayBuffer();

    await splitAndUploadToR2(arrayBuffer, Number(episodeId));

    return c.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown server error";
    return c.json({ success: false, error: message }, 500);
  }
});

export default app;
