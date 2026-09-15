/**
 * Issuing and reading the session token.
 *
 * The token carries `tv`, the account's session version. It is read back from
 * the database on every request: incrementing the version instantly invalidates
 * every token already issued. Without it, “sign out” merely discards a token
 * that stays valid until it expires.
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
  // Different lengths: `timingSafeEqual` would throw instead of refusing.
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
