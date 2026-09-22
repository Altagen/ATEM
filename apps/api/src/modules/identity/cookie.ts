/**
 * How the token travels.
 *
 * The token is `httpOnly`: no script on the page can read it, which puts it out
 * of reach of an injection.
 *
 * There was a second, readable cookie here, meant to tell the front that a
 * session exists. Nobody ever read it — the front asks `/auth/me`, which gives
 * it the identity along with the answer. So it went out on every request for
 * nothing, with a comment describing a role nothing played.
 */
import type { Context } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";

export const SESSION_COOKIE = "atem_session";

/**
 * `Secure` is lifted on localhost only: in development the browser would refuse
 * a `Secure` cookie served in the clear, and nobody could sign in.
 */
function isPlainLocalhost(c: Context): boolean {
  const host = new URL(c.req.url).hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

export function setSessionCookie(c: Context, token: string): void {
  const secure = !isPlainLocalhost(c);
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: "Strict",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}
