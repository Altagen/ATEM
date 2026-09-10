/**
 * L'authentification des requêtes.
 *
 * Le contenu du jeton n'est jamais cru sur parole : rôle, suspension et version
 * de session sont relus en base à chaque requête. Un jeton reste sinon valable
 * après une suspension, jusqu'à son expiration.
 */
import { eq } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import type { Database } from "../../db/client.js";
import { unauthorized } from "../../platform/errors.js";
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

/** Renseigne `viewer` quand la session est valide. Ne refuse jamais. */
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
        }
      }
    }
    await next();
  };
}

/** Exige une session. À monter après `attachViewer`. */
export const requireViewer: MiddlewareHandler = async (c, next) => {
  if (!c.get("viewer")) throw unauthorized();
  await next();
};
