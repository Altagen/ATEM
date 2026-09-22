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
import { forbidden, loggableError, notFound, unauthorized } from "../../platform/errors.js";
import { SESSION_COOKIE } from "./cookie.js";
import { users } from "./schema.js";
import { readToken } from "./token.js";

export type Viewer = { id: string; role: string; locale: string; mustChangePassword: boolean };

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
            mustChangePassword: users.mustChangePassword,
          })
          .from(users)
          .where(eq(users.id, payload.sub))
          .limit(1);

        if (row && !row.suspendedAt && row.tokenVersion === payload.tv) {
          c.set("viewer", {
            id: row.id, role: row.role, locale: row.locale, mustChangePassword: row.mustChangePassword,
          });
          await touchLastSeen(db, row.id);
        }
      }
    }
    await next();
  };
}

/** A session's own gestures: who am I, which language, and leaving. */
const SESSION_ONLY = new Set(["GET /auth/me", "PATCH /auth/me/locale", "POST /auth/logout"]);

/**
 * What an account may reach **before** it has chosen its own password — one
 * set by the administrator, who therefore knows it. Nothing else: an account
 * someone else can sign in to must not be used until it is really its owner's.
 */
const BEFORE_PASSWORD_CHANGE = new Set([...SESSION_ONLY, "POST /auth/me/first-password"]);

/**
 * The administrator's account reaches the console and its session — nothing a
 * player does (the maintainer, 2026-09-21: “it is an administrator, nothing more”). No collection, no
 * friends, no duel, and no profile to rename or password to change: those
 * come from the configuration, and a change made here would be undone at the
 * next start.
 */
const adminMayReach = (method: string, path: string): boolean =>
  path === "/admin" || path.startsWith("/admin/") || SESSION_ONLY.has(`${method} ${path}`);

/**
 * Requires a session — and holds the two accounts that may not go everywhere.
 * To be mounted after `attachViewer`.
 *
 * Both rules live here, where every route already passes, rather than in each
 * module: a route added tomorrow is covered without anyone remembering to.
 */
export const requireViewer: MiddlewareHandler = async (c, next) => {
  const viewer = c.get("viewer");
  // The message is spelled out: the default of `unauthorized()` would never
  // reach the dictionary, and the screen would show it in English.
  if (!viewer) throw unauthorized("Authentication required.");
  const gesture = `${c.req.method} ${c.req.path}`;
  if (viewer.role === "admin") {
    if (!adminMayReach(c.req.method, c.req.path)) {
      throw forbidden("This account administers the instance; it does not play.");
    }
  } else if (viewer.mustChangePassword && !BEFORE_PASSWORD_CHANGE.has(gesture)) {
    throw forbidden("Choose your own password first.");
  }
  await next();
};

/**
 * The console is the administrator's. To anyone else it does not exist: “not
 * found”, as every refused read answers here.
 */
export const requireAdmin: MiddlewareHandler = async (c, next) => {
  if (c.get("viewer")?.role !== "admin") throw notFound();
  await next();
};
