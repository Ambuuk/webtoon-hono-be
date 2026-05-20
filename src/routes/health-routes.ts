import { Hono } from "hono";

const app = new Hono();

app.get("/", (c) =>
  c.json({ status: "OK", message: "Service is running normally" }),
);

export default app;
