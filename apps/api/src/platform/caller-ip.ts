/**
 * The caller's address, for rate limiting.
 *
 * `X-Forwarded-For` is a header **the client can write**. ATEM-old discovered
 * in production that its limiting could be bypassed by forging it: a different
 * address on every request, hence a counter forever at zero.
 *
 * So we read that header only if the instance declares its trusted proxies in
 * `ATEM_TRUSTED_PROXIES`. Without that declaration we take the connection's
 * address, even if it means counting everyone together behind a proxy — erring
 * on the strict side is the sensible way to be wrong.
 */
import type { MiddlewareHandler } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";

declare module "hono" {
  interface ContextVariableMap {
    callerIp: string;
  }
}

const trustedProxies = () =>
  (process.env.ATEM_TRUSTED_PROXIES ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

/**
 * The connection's address, or `unknown`.
 *
 * `getConnInfo` assumes the Node adapter and throws without it — under test, or
 * under another adapter. A rate limiter that brings the server down when it
 * does not know who is calling is worse than the problem it treats: we degrade
 * to a shared, stricter bucket, never to an outage.
 */
function connectionAddress(c: Parameters<MiddlewareHandler>[0]): string {
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

export const attachCallerIp: MiddlewareHandler = async (c, next) => {
  const direct = connectionAddress(c);
  const trusted = trustedProxies();

  if (trusted.length > 0 && trusted.includes(direct)) {
    const forwarded = c.req.header("X-Forwarded-For");
    const first = forwarded?.split(",")[0]?.trim();
    c.set("callerIp", first || direct);
  } else {
    c.set("callerIp", direct);
  }
  await next();
};
