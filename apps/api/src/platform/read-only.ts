/**
 * A route tree that can only be read.
 *
 * ADR-009: a route carrying **someone else's** identity in its path must never
 * write. Review vigilance does not hold that over time — the day someone adds a
 * `POST` next to a `GET /players/:id`, it would take the owner from the path. So
 * the refusal is mounted first, on the whole tree, before any route exists: a
 * write added later is refused before it runs, whatever it does.
 */
import { Hono } from "hono";

const READS = new Set(["GET", "HEAD"]);

export function readOnlyRoutes(): Hono {
  const app = new Hono();
  app.use("*", async (c, next) => {
    if (!READS.has(c.req.method)) {
      c.header("Allow", "GET, HEAD");
      return c.json({ error: "method_not_allowed", message: "This resource can only be read." }, 405);
    }
    await next();
  });
  return app;
}
