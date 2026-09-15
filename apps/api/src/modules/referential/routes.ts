import { Hono } from "hono";
import type { Database } from "../../db/client.js";
import { invalidInput, notFound } from "../../platform/errors.js";
import { requireViewer } from "../identity/index.js";
import { getCard, listPrintsForCard, resolvePrintBySetCode, toCardDetail } from "./service.js";
import { cards } from "./schema.js";
import { eq } from "drizzle-orm";

export function referentialRoutes(db: Database) {
  const app = new Hono();

  /**
   * The catalogue requires a session.
   *
   * It stays deliberately thin: search by name was removed along with the
   * “Catalogue” screen, which did not exist in ATEM-old and duplicated a
   * function the collection already provides. Adding a card to the collection
   * resolves its code through `POST /collection/adjust`, not through here.
   */
  app.use("*", requireViewer);

  /**
   * A card's name from its set code — **without writing anywhere**.
   *
   * This is what the scanlist needs: it inventories a batch without pouring it,
   * and must be able to display “Great White” rather than “LTGY-FR008”. It
   * cannot go through `POST /collection/adjust`, which would add the card to
   * the collection — precisely what it refuses to do.
   *
   * Resolution may enrich the referential along the way: that is its purpose,
   * and it is shared by everyone. What it never touches is anyone's inventory.
   */
  app.get("/impressions/:setCode", async (c) => {
    const setCode = c.req.param("setCode");
    if (!setCode) throw invalidInput("Empty set code.");

    const print = await resolvePrintBySetCode(db, setCode);
    if (!print?.cardPasscode) return c.json({ setCode, card: null });

    const [row] = await db
      .select()
      .from(cards)
      .where(eq(cards.passcode, print.cardPasscode))
      .limit(1);

    return c.json({
      setCode: print.setCode,
      card: row ? toCardDetail(row, c.get("viewer")?.locale ?? "fr") : null,
    });
  });

  /** The card and all its editions — what the “Other printings” block shows. */
  app.get("/cards/:passcode", async (c) => {
    const passcode = Number(c.req.param("passcode"));
    if (!Number.isInteger(passcode)) throw invalidInput("Invalid passcode.");
    const card = await getCard(db, passcode, c.get("viewer")?.locale ?? "fr");
    if (!card) throw notFound("Unknown card.");
    return c.json({ card, prints: await listPrintsForCard(db, passcode) });
  });

  return app;
}
