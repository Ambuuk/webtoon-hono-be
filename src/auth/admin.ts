// Type-only module — replaces firebase-admin for CF Workers compatibility.
// Runtime JWT verification is handled in firebase-auth.ts via jose + Google JWKS.
export type { DecodedIdToken } from "../types/firebase";
