/**
 * Request authentication.
 *
 * The token's content is never taken at face value: role, suspension and
 * session version are read back from the database on every request. Otherwise a
 * token stays valid after a suspension, until it expires.
 */
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import type { Database } from "../../db/client.js";
import { loggableError, unauthorized } from "../../platform/errors.js";
import { SESSION_COOKIE } from "./cookie.js";
import { users } from "./schema.js";
import { readToken } from "./token.js";

export type Viewer = { id: string; role: string; locale: string };

declare module "hono" {
  interface ContextVariableMap {
    viewer: Viewer | null;
  }
}

function extractToken(c: Context): string | null {
  const header = c.req.header("Authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7);
  return getCookie(c, SESSION_COOKIE) ?? null;
}

/**
 * Records that this account is active — at most once every few minutes.
 *
 * The condition is in the `WHERE`, so it costs one write per account per
 * period rather than one per request, and no read at all. A failure here is
 * swallowed: presence is a comfort, and must never turn a working request into
 * an error.
 */
// Well under the five-minute window of `listProfiles`, so a live tab never
// flickers offline between two stamps.
const PRESENCE_PERIOD = "1 minute";

async function touchLastSeen(db: Database, userId: string): Promise<void> {
  try {
    await db
      .update(users)
      .set({ lastSeenAt: new Date() })
      .where(and(
        eq(users.id, userId),
        or(
          isNull(users.lastSeenAt),
          lt(users.lastSeenAt, sql`now() - interval '${sql.raw(PRESENCE_PERIOD)}'`),
        ),
      ));
  } catch (error) {
    console.warn("[atem] last seen not recorded:", loggableError(error));
  }
}

/** Fills in `viewer` when the session is valid. Never refuses. */
export function attachViewer(db: Database): MiddlewareHandler {
  return async (c, next) => {
    c.set("viewer", null);
    const token = extractToken(c);
    if (token) {
      const payload = readToken(token);
      if (payload) {
        const [row] = await db
          .select({
            id: users.id,
            role: users.role,
            locale: users.locale,
            tokenVersion: users.tokenVersion,
            suspendedAt: users.suspendedAt,
          })
          .from(users)
          .where(eq(users.id, payload.sub))
          .limit(1);

        if (row && !row.suspendedAt && row.tokenVersion === payload.tv) {
          c.set("viewer", { id: row.id, role: row.role, locale: row.locale });
          await touchLastSeen(db, row.id);
        }
      }
    }
    await next();
  };
}

/** Requires a session. To be mounted after `attachViewer`. */
export const requireViewer: MiddlewareHandler = async (c, next) => {
  // The message is spelled out: the default of `unauthorized()` would never
  // reach the dictionary, and the screen would show it in English.
  if (!c.get("viewer")) throw unauthorized("Authentication required.");
  await next();
};
