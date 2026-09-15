import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Database } from "../../db/client.js";
import { requireViewer } from "../identity/index.js";
import { ensureCardImage } from "./media.js";
import { cards } from "./schema.js";

/**
 * Card images, served from ATEM's own disk.
 *
 * Mounted on `/media`, outside `/api`, so the front can use the address in an
 * `<img>` as is, and nginx can give it a long cache.
 *
 * **A session is required.** The first request for an image makes the server
 * download it: open to anyone, the route would let a stranger make the
 * instance pull all 14,524 artworks from YGOPRODeck. `<img>` requests carry the
 * session cookie, so the screens are not affected.
 */
export function mediaRoutes(db: Database) {
  const app = new Hono();

  app.use("*", requireViewer);

  app.get("/cards/:file", async (c) => {
    /*
     * The name is matched whole, anchored at both ends: a passcode, an optional
     * `-small`, `.jpg`. Nothing else reaches the disk — no `..`, no other
     * directory, no other extension.
     */
    const match = /^(\d{1,10})(-small)?\.jpg$/.exec(c.req.param("file"));
    if (!match) return c.body(null, 400);

    const passcode = Number(match[1]);
    const variant = match[2] ? "small" : "full";

    // The remote address comes from our catalogue, never from the request.
    const [card] = await db
      .select({ imageUrl: cards.imageUrl, imageUrlSmall: cards.imageUrlSmall })
      .from(cards)
      .where(eq(cards.passcode, passcode))
      .limit(1);
    if (!card) return c.body(null, 404);

    const file = await ensureCardImage(
      passcode,
      variant,
      variant === "small" ? card.imageUrlSmall : card.imageUrl,
    );
    if (!file) return c.body(null, 404);

    return c.body(await readFile(file), 200, {
      "Content-Type": "image/jpeg",
      // A passcode identifies a card, and a card's artwork never changes.
      "Cache-Control": "public, max-age=31536000, immutable",
    });
  });

  return app;
}
