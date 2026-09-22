/**
 * Security headers and CSRF guard.
 *
 * The origin guard complements `SameSite=Strict`: it applies to writes only,
 * and only when authentication goes through a cookie. An
 * `Authorization: Bearer` cannot be attached unintentionally by a browser —
 * requiring it there would be noise without gain.
 */
import type { MiddlewareHandler } from "hono";
import { bodyLimit as honoBodyLimit } from "hono/body-limit";
import { forbidden } from "./errors.js";

export const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "same-origin");
  c.header("X-Frame-Options", "DENY");
  c.header("Cross-Origin-Opener-Policy", "same-origin");
};

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * The guard compares **hosts**, not whole origins.
 *
 * The scheme cannot enter the comparison: as soon as a TLS termination sits in
 * front — nginx in production, the development server over HTTPS — the API
 * receives cleartext and computes `http://…` while the browser announces
 * `https://…`. The two never match, and **every write is refused**: adding a
 * card, signing out, changing a setting. The symptom is an opaque 403, and
 * signing in still works — the guard stays silent as long as there is no
 * cookie.
 *
 * This is not a concession: what protects here is that the page's host is ours,
 * backed by a `SameSite=Strict` cookie. An `http://` and an `https://` on the
 * same host are not two different sites for the question at hand.
 *
 * Trusting `X-Forwarded-Proto` was the other path; it requires knowing which
 * proxies are trustworthy, failing which anyone fabricates the header.
 * Comparing the host requires nothing.
 */
export const csrfGuard: MiddlewareHandler = async (c, next) => {
  if (!WRITE_METHODS.has(c.req.method)) return next();
  // Token carried explicitly: a browser never adds it by itself.
  if (c.req.header("Authorization")?.startsWith("Bearer ")) return next();

  const origin = c.req.header("Origin");
  if (!origin) return next();

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw forbidden("Unreadable origin.");
  }

  // `Host` as the proxy passed it on; failing that, the request's own.
  const expectedHost = c.req.header("Host") ?? new URL(c.req.url).host;
  if (originHost !== expectedHost) {
    throw forbidden("Origin not allowed.");
  }
  await next();
};

/**
 * A request with an unbounded body can exhaust the server's memory.
 *
 * The original version only read the **announced** `Content-Length`. A chunked
 * request carries none: `Number(undefined ?? 0)` was zero, and it went through
 * whole. A non-numeric header gave `NaN`, whose comparison is false — it went
 * through too.
 *
 * Hono's counts bytes as they arrive and stops on overflow, whatever the
 * request announces. Our error response keeps the shape of the others: a JSON
 * body with a code, which the client already knows how to read.
 */
export function bodyLimit(maxBytes: number): MiddlewareHandler {
  return honoBodyLimit({
    maxSize: maxBytes,
    onError: (c) => c.json({ error: "payload_too_large" }, 413),
  });
}
