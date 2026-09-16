/**
 * The caller's address, for rate limiting.
 *
 * `X-Forwarded-For` is a header **the client can write**. ATEM-old discovered
 * in production that its limiting could be bypassed by forging it: a different
 * address on every request, hence a counter forever at zero.
 *
 * So we read that header only if the instance declares its trusted proxies in
 * `ATEM_TRUSTED_PROXIES`, as addresses or CIDR ranges. Without that declaration
 * we take the connection's address.
 *
 * **Declaring it matters more than it looks.** Behind the bundled nginx every
 * request arrives from the proxy's own address, so without this variable the
 * whole instance shares one rate-limit bucket: ten failed sign-ins — anyone's —
 * lock everyone out for fifteen minutes, and five registrations exhaust the
 * hour. `compose.yaml` therefore fixes the network's subnet and names it here,
 * so the shipped deployment is not the broken one.
 */
import { BlockList, isIPv4 } from "node:net";
import type { MiddlewareHandler } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";

declare module "hono" {
  interface ContextVariableMap {
    callerIp: string;
  }
}

/**
 * The trusted proxies, as exact addresses **or** CIDR ranges.
 *
 * Ranges are what make this usable at all in a container: compose hands the
 * proxy a different address on every recreation, so an exact list could never
 * be written down. `net.BlockList` does the matching — comparing addresses by
 * hand is where this kind of check goes wrong.
 *
 * Rebuilt on each call rather than cached: the cost is one list of one or two
 * entries, and a cached one would ignore a changed environment — which is
 * exactly what the tests need to vary.
 */
function trustedList(): BlockList | null {
  const entries = (process.env.ATEM_TRUSTED_PROXIES ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length === 0) return null;

  const list = new BlockList();
  for (const entry of entries) {
    const [address = "", bits] = entry.split("/");
    const family = isIPv4(address) ? "ipv4" : "ipv6";
    try {
      if (bits === undefined) list.addAddress(address, family);
      else list.addSubnet(address, Number(bits), family);
    } catch {
      // A malformed entry trusts nobody rather than everybody: the header stays
      // ignored, and the connection's own address is used.
      console.warn(`[atem] ATEM_TRUSTED_PROXIES: “${entry}” is not an address or a range`);
    }
  }
  return list;
}

/**
 * `::ffff:172.18.0.3` and `172.18.0.3` are the same machine.
 *
 * Node reports an IPv4 address in its IPv6-mapped form when the socket listens
 * on both families — which is the normal case. Comparing the mapped form
 * against an IPv4 range matches nothing, and the proxy is silently distrusted.
 */
const unmap = (address: string): string =>
  address.startsWith("::ffff:") && isIPv4(address.slice(7)) ? address.slice(7) : address;

function isTrusted(address: string): boolean {
  const list = trustedList();
  if (!list) return false;
  const plain = unmap(address);
  try {
    return list.check(plain, isIPv4(plain) ? "ipv4" : "ipv6");
  } catch {
    return false;
  }
}

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

/**
 * Which address counts, given the connection's and what the header claims.
 *
 * Separated from the middleware so it can be measured directly: the rule this
 * decides — believe the header, or not — is the whole point of the file, and it
 * was the one thing no test touched.
 */
export function resolveCallerIp(direct: string, forwarded: string | undefined): string {
  if (!isTrusted(direct)) return unmap(direct);
  const first = forwarded?.split(",")[0]?.trim();
  return first ? unmap(first) : unmap(direct);
}

export const attachCallerIp: MiddlewareHandler = async (c, next) => {
  c.set("callerIp", resolveCallerIp(connectionAddress(c), c.req.header("X-Forwarded-For")));
  await next();
};
