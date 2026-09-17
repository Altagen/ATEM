/**
 * The social routes, mounted under `/community`.
 *
 * The identifier in the path is the **other** person — the target of a relation
 * — never the owner of what is written. The owner is always the session
 * (ADR-009): `POST /community/friends/:id` writes a row about the caller and
 * that person, and there is no route to write someone else's relations.
 */
import { Hono } from "hono";
import type { Database } from "../../db/client.js";
import { invalidInput } from "../../platform/errors.js";
import { requireViewer } from "../identity/index.js";
import {
  acceptFriend, blockPlayer, listBlocked, listDuellists, removeFriend, requestFriend,
  unblockPlayer,
} from "./service.js";

export function socialRoutes(db: Database) {
  const app = new Hono();
  app.use("*", requireViewer);

  const viewerId = (c: { get: (key: "viewer") => { id: string } | null }): string => {
    const viewer = c.get("viewer");
    if (!viewer) throw invalidInput("No session.");
    return viewer.id;
  };

  app.get("/duellists", async (c) => {
    const search = c.req.query("q") ?? undefined;
    if (search !== undefined && search.length > 64) throw invalidInput("Search too long.");
    return c.json(await listDuellists(db, viewerId(c), { search }));
  });

  app.post("/friends/:id", async (c) =>
    c.json({ friendStatus: await requestFriend(db, viewerId(c), c.req.param("id")) }));

  app.post("/friends/:id/accept", async (c) =>
    c.json({ friendStatus: await acceptFriend(db, viewerId(c), c.req.param("id")) }));

  /** Removing a friend, refusing a request, cancelling one's own: one gesture. */
  app.delete("/friends/:id", async (c) =>
    c.json({ friendStatus: await removeFriend(db, viewerId(c), c.req.param("id")) }));

  app.get("/blocks", async (c) => c.json({ items: await listBlocked(db, viewerId(c)) }));

  app.post("/blocks/:id", async (c) => {
    await blockPlayer(db, viewerId(c), c.req.param("id"));
    return c.json({ isBlocked: true, friendStatus: "none" });
  });

  app.delete("/blocks/:id", async (c) => {
    await unblockPlayer(db, viewerId(c), c.req.param("id"));
    return c.json({ isBlocked: false });
  });

  return app;
}
