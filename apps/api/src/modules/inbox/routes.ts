/**
 * The inbox routes. Everything here is about the caller's own inbox: no path
 * carries whose it is, because there is only one it could be.
 */
import { Hono } from "hono";
import type { Database } from "../../db/client.js";
import { invalidInput } from "../../platform/errors.js";
import { requireViewer } from "../identity/index.js";
import { listInbox, markAllRead, removeNotification, unreadCount } from "./service.js";

export function inboxRoutes(db: Database) {
  const app = new Hono();
  app.use("*", requireViewer);

  const viewerId = (c: { get: (key: "viewer") => { id: string } | null }): string => {
    const viewer = c.get("viewer");
    if (!viewer) throw invalidInput("No session.");
    return viewer.id;
  };

  app.get("/", async (c) => {
    const id = viewerId(c);
    return c.json({ items: await listInbox(db, id), unread: await unreadCount(db, id) });
  });

  /** The count alone: what the navigation reads, without the lines. */
  app.get("/unread", async (c) => c.json({ unread: await unreadCount(db, viewerId(c)) }));

  app.post("/read-all", async (c) => {
    await markAllRead(db, viewerId(c));
    return c.json({ ok: true });
  });

  app.delete("/:id", async (c) => {
    await removeNotification(db, viewerId(c), c.req.param("id"));
    return c.json({ ok: true });
  });

  return app;
}
