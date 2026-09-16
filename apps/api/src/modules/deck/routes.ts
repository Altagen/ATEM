/**
 * The deck routes.
 *
 * **Reads take an owner, writes take a viewer** (ADR-009). Today both are the
 * same person — no route carries someone else's identity yet — but the services
 * already say so, and that is what will make the Duellists additive rather than
 * a rewrite.
 */
import { Hono } from "hono";
import { z } from "zod";
import { DECK_MAX_COPIES, DECK_ZONE_LIMITS, DECK_ZONES, LIMITS } from "@atem/shared";
import type { Database } from "../../db/client.js";
import { invalidInput } from "../../platform/errors.js";
import { requireViewer } from "../identity/index.js";
import {
  createDeck, deleteDeck, getDeck, listDecks, setDeckCard, updateDeck,
} from "./service.js";
import { createFolder, deleteFolder, listFolders, updateFolder } from "./folders.js";

const CreateBody = z.object({
  name: z.string().trim().min(1).max(LIMITS.deckName.max),
  folderId: z.string().uuid().nullable().optional(),
});

const PatchBody = z.object({
  name: z.string().trim().min(1).max(LIMITS.deckName.max).optional(),
  /** `null` moves the deck back to the root; absent leaves the filing alone. */
  folderId: z.string().uuid().nullable().optional(),
  /**
   * The Main Deck size aimed at. Any whole number the rules allow is accepted,
   * not only the five the picker offers: a deck built towards 41 is a
   * legitimate intention, it is just not worth a line in a menu.
   */
  targetMain: z
    .number()
    .int()
    .min(DECK_ZONE_LIMITS.main.min)
    .max(DECK_ZONE_LIMITS.main.max)
    .optional(),
});

const FolderBody = z.object({
  name: z.string().trim().min(1).max(LIMITS.deckName.max),
  parentId: z.string().uuid().nullable().optional(),
});

const FolderPatchBody = z.object({
  name: z.string().trim().min(1).max(LIMITS.deckName.max).optional(),
  parentId: z.string().uuid().nullable().optional(),
});

const CardBody = z.object({
  passcode: z.number().int().positive(),
  zone: z.enum(DECK_ZONES),
  quantity: z.number().int().min(0).max(DECK_MAX_COPIES),
});

export function deckRoutes(db: Database) {
  const app = new Hono();
  app.use("*", requireViewer);

  const viewerId = (c: { get: (key: "viewer") => { id: string } | null }): string => {
    const viewer = c.get("viewer");
    if (!viewer) throw invalidInput("No session.");
    return viewer.id;
  };

  const jsonBody = async (c: { req: { json: () => Promise<unknown> } }): Promise<unknown> => {
    try {
      return await c.req.json();
    } catch {
      throw invalidInput("Unreadable request body.");
    }
  };

  app.get("/", async (c) => c.json({ items: await listDecks(db, viewerId(c)) }));

  app.post("/", async (c) => {
    const parsed = CreateBody.safeParse(await jsonBody(c));
    if (!parsed.success) throw invalidInput("Invalid deck name.");
    return c.json(
      await createDeck(db, viewerId(c), parsed.data.name, parsed.data.folderId ?? null),
      201,
    );
  });

  /**
   * Folders, **before** `/:id`.
   *
   * Hono tries routes in declaration order: further down, `/folders` would be
   * swallowed by `/:id`, which would answer “invalid identifier” for a folder
   * list. A test holds that order, because moving a few lines would be enough
   * to undo it silently.
   */
  app.get("/folders", async (c) => c.json({ items: await listFolders(db, viewerId(c)) }));

  app.post("/folders", async (c) => {
    const parsed = FolderBody.safeParse(await jsonBody(c));
    if (!parsed.success) throw invalidInput("Invalid folder name.");
    return c.json(await createFolder(db, viewerId(c), parsed.data), 201);
  });

  app.patch("/folders/:id", async (c) => {
    const parsed = FolderPatchBody.safeParse(await jsonBody(c));
    if (!parsed.success) throw invalidInput("Invalid data.");
    return c.json(await updateFolder(db, viewerId(c), c.req.param("id"), parsed.data));
  });

  app.delete("/folders/:id", async (c) => {
    await deleteFolder(db, viewerId(c), c.req.param("id"));
    return c.json({ ok: true });
  });

  app.get("/:id", async (c) => c.json(await getDeck(db, viewerId(c), c.req.param("id"))));

  app.patch("/:id", async (c) => {
    const parsed = PatchBody.safeParse(await jsonBody(c));
    if (!parsed.success) throw invalidInput("Invalid data.");
    await updateDeck(db, viewerId(c), c.req.param("id"), parsed.data);
    return c.json({ ok: true });
  });

  app.delete("/:id", async (c) => {
    await deleteDeck(db, viewerId(c), c.req.param("id"));
    return c.json({ ok: true });
  });

  /**
   * Sets the quantity of a card in a zone.
   *
   * `PUT` and not `POST`: we declare a state — “three copies in the Main” — not
   * an increment. Two identical requests leave the same deck, which guards
   * against a double tap without any counter to reconcile.
   */
  app.put("/:id/cards", async (c) => {
    const parsed = CardBody.safeParse(await jsonBody(c));
    if (!parsed.success) throw invalidInput("Invalid data.", { issues: parsed.error.issues });
    return c.json(await setDeckCard(db, viewerId(c), c.req.param("id"), parsed.data));
  });

  return app;
}
