import { Hono } from "hono";
import { cors } from "hono/cors";
import type { DecodedIdToken } from "./types/firebase";
import { firebaseAuth, softFirebaseAuth } from "./auth/firebase-auth";
import healthRoutes from "./routes/health-routes";
import readerRoutes from "./routes/reader-routes";
import adminRoutes from "./routes/admin-routes";
import publicRoutes from "./routes/public-routes";
import translatorRoutes from "./routes/translator-routes";
import uploadRoutes from "./routes/upload-routes";
import moderatorRoutes from "./routes/moderator-routes";
import mobileRoutes from "./routes/mobile-routes";

export type Variables = {
  user?: DecodedIdToken;
};

const app = new Hono<{ Variables: Variables }>();

const allowedOrigins = [
  "http://localhost:5173",
  "https://www.hmanhwa.xyz",
  "https://hmanhwa.xyz",
  "http://192.168.1.27:5173",
  "https://www.nekoma.mn",
  "https://nekoma.mn",
];

app.use(
  "*",
  cors({
    origin: allowedOrigins,
  }),
);

app.route("/", healthRoutes);
app.use("/api/reader/*", firebaseAuth);
app.route("/api/reader", readerRoutes);
app.use("/api/admin/*", firebaseAuth);
app.route("/api/admin", adminRoutes);
app.use("/api/translator/*", firebaseAuth);
app.route("/api/translator", translatorRoutes);
app.route("/api/public", publicRoutes);
app.use("/api/uploader/*", firebaseAuth);
app.route("/api/uploader", uploadRoutes);
app.use("/api/moderator/*", firebaseAuth);
app.route("/api/moderator", moderatorRoutes);
app.route("/api/mobile", mobileRoutes);

export default app;
