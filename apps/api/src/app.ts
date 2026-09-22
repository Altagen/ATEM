/**
 * The assembly.
 *
 * Order matters: Hono applies a middleware only to routes declared **after**
 * it. Security headers, body limit, caller address, session, CSRF guard — then
 * the modules.
 */
import { Hono } from "hono";
import { ZodError } from "zod";
import type { Database } from "./db/client.js";
import { AppError, loggableError } from "./platform/errors.js";
import { attachCallerIp } from "./platform/caller-ip.js";
import { bodyLimit, csrfGuard, securityHeaders } from "./platform/security.js";
import { attachViewer, identityRoutes, onAccountDeletion } from "./modules/identity/index.js";
import { mediaRoutes, referentialRoutes } from "./modules/referential/index.js";
import { collectionRoutes } from "./modules/collection/index.js";
import { scanlistRoutes } from "./modules/scanlist/index.js";
import { deckRoutes } from "./modules/deck/index.js";
import { playerRoutes } from "./modules/player/index.js";
import { socialRoutes } from "./modules/social/index.js";
import { inboxRoutes } from "./modules/inbox/index.js";
import { adminRoutes } from "./modules/admin/index.js";
import { duelRoutes, forgetPlayerDuels } from "./modules/duel/index.js";

export function createApp(db: Database) {
  const app = new Hono();

  // What an account's deletion asks of the other modules, beyond the foreign
  // keys: identity calls these, and knows none of them.
  onAccountDeletion(forgetPlayerDuels);

  app.use("*", securityHeaders);
  app.use("*", bodyLimit(6 * 1024 * 1024));
  app.use("*", attachCallerIp);
  app.use("*", attachViewer(db));
  app.use("*", csrfGuard);

  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json({ error: err.code, message: err.message, details: err.details }, err.status as 400);
    }
    if (err instanceof ZodError) {
      return c.json({ error: "invalid_input", issues: err.issues }, 400);
    }
    console.error("[atem] unhandled error:", loggableError(err));
    return c.json({ error: "internal" }, 500);
  });

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.route("/auth", identityRoutes(db));
  app.route("/catalogue", referentialRoutes(db));
  app.route("/media", mediaRoutes(db));
  app.route("/collection", collectionRoutes(db));
  app.route("/scanlists", scanlistRoutes(db));
  app.route("/decks", deckRoutes(db));
  app.route("/players", playerRoutes(db));
  app.route("/community", socialRoutes(db));
  app.route("/inbox", inboxRoutes(db));
  app.route("/admin", adminRoutes(db));
  app.route("/duels", duelRoutes(db));

  return app;
}
