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
import { AppError } from "./platform/errors.js";
import { attachCallerIp } from "./platform/caller-ip.js";
import { bodyLimit, csrfGuard, securityHeaders } from "./platform/security.js";
import { attachViewer, identityRoutes } from "./modules/identity/index.js";
import { referentialRoutes } from "./modules/referential/index.js";
import { collectionRoutes } from "./modules/collection/index.js";
import { scanlistRoutes } from "./modules/scanlist/index.js";
import { deckRoutes } from "./modules/deck/index.js";

export function createApp(db: Database) {
  const app = new Hono();

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
    console.error("[atem] unhandled error:", err);
    return c.json({ error: "internal" }, 500);
  });

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.route("/auth", identityRoutes(db));
  app.route("/catalogue", referentialRoutes(db));
  app.route("/collection", collectionRoutes(db));
  app.route("/scanlistes", scanlistRoutes(db));
  app.route("/decks", deckRoutes(db));

  return app;
}
