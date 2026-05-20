import { createRemoteJWKSet, jwtVerify } from "jose";
import { createMiddleware } from "hono/factory";
import type { DecodedIdToken } from "../types/firebase";
import type { Variables } from "../index";

const FIREBASE_JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

const JWKS = createRemoteJWKSet(new URL(FIREBASE_JWKS_URL));

async function verifyToken(token: string): Promise<DecodedIdToken> {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: `https://securetoken.google.com/${projectId}`,
    audience: projectId,
  });

  const uid = payload.sub ?? (payload.user_id as string);
  return {
    ...(payload as Record<string, any>),
    uid,
    user_id: uid,
  } as DecodedIdToken;
}

export const firebaseAuth = createMiddleware<{ Variables: Variables }>(
  async (c, next) => {
    const token = c.req.header("Authorization")?.split("Bearer ")[1];
    if (!token) return c.body(null, 401);

    try {
      const user = await verifyToken(token);
      c.set("user", user);
      await next();
    } catch {
      return c.body(null, 401);
    }
  },
);

export const softFirebaseAuth = createMiddleware<{ Variables: Variables }>(
  async (c, next) => {
    const token = c.req.header("Authorization")?.split("Bearer ")[1];
    if (!token) {
      c.set("user", undefined);
      await next();
      return;
    }

    try {
      const user = await verifyToken(token);
      c.set("user", user);
    } catch {
      c.set("user", undefined);
    }
    await next();
  },
);
