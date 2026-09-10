/**
 * Émission et lecture du jeton de session.
 *
 * Le jeton porte `tv`, la version de session du compte. Elle est relue en base à
 * chaque requête : incrémenter la version en base invalide instantanément tous
 * les jetons déjà émis. Sans ça, « se déconnecter » ne fait que jeter un jeton
 * qui reste valable jusqu'à son expiration.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { requireJwtSecret } from "./secret.js";

const TTL_SECONDS = 60 * 60 * 24 * 30;

export type TokenPayload = { sub: string; tv: number; exp: number };

const b64 = (input: Buffer | string) =>
  Buffer.from(input).toString("base64url");

function sign(data: string): string {
  return createHmac("sha256", requireJwtSecret()).update(data).digest("base64url");
}

export function issueToken(userId: string, tokenVersion: number): string {
  const header = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64(
    JSON.stringify({
      sub: userId,
      tv: tokenVersion,
      exp: Math.floor(Date.now() / 1000) + TTL_SECONDS,
    } satisfies TokenPayload),
  );
  const body = `${header}.${payload}`;
  return `${body}.${sign(body)}`;
}

export function readToken(token: string): TokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts as [string, string, string];

  const expected = Buffer.from(sign(`${header}.${payload}`));
  const received = Buffer.from(signature);
  // Longueurs différentes : `timingSafeEqual` lèverait au lieu de refuser.
  if (expected.length !== received.length) return null;
  if (!timingSafeEqual(expected, received)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString()) as TokenPayload;
    if (typeof parsed.sub !== "string" || typeof parsed.tv !== "number") return null;
    if (typeof parsed.exp !== "number" || parsed.exp * 1000 < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}
