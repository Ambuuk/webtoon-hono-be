import { Hono } from "hono";
import type { Variables } from "../index";
import { softFirebaseAuth } from "../auth/firebase-auth";
import {
  getLatestComments,
  getNewWebtoons,
  getVideos,
  searchWebtoon,
  getLatestWebtoons,
  getWebtoonDetail,
} from "../service/user/user-service";
import { checkPayment } from "../service/payment/payment-service";

const app = new Hono<{ Variables: Variables }>();

app.get("/callback", async (c) => {
  const invoice_no = c.req.query("invoice_no");
  await checkPayment(Number(invoice_no));
  return c.text("Callback received");
});

app.post("/getNewWebtoons", async (c) => {
  const webtoons = await getNewWebtoons();
  return c.json(webtoons);
});

app.post("/getLatestWebtoons", async (c) => {
  const webtoons = await getLatestWebtoons();
  return c.json(webtoons);
});

app.post("/searchByTitle", async (c) => {
  const { searchStr } = await c.req.json();
  const webtoons = await searchWebtoon(searchStr);
  return c.json(webtoons);
});

app.post("/getWebtoonDetail", softFirebaseAuth, async (c) => {
  const { webtoonId } = await c.req.json();
  const webtoon = await getWebtoonDetail(webtoonId, c.get("user"));
  return c.json(webtoon);
});

app.get("/getVideos", async (c) => {
  const videos = await getVideos();
  return c.json(videos);
});

app.get("/getLatestComments", async (c) => {
  const comments = await getLatestComments();
  return c.json(comments);
});

export default app;
