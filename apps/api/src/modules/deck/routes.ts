/**
 * Les routes des decks.
 *
 * **Les lectures prennent un propriétaire, les écritures un viewer** (ADR-009).
 * Aujourd'hui les deux sont la même personne — aucune route ne porte encore
 * l'identité d'autrui — mais les services le disent déjà, et c'est ce qui rendra
 * les Duellistes additifs plutôt qu'une reprise.
 */
import { Hono } from "hono";
import { z } from "zod";
import { DECK_MAX_COPIES, DECK_ZONES, LIMITS } from "@atem/shared";
import type { Database } from "../../db/client.js";
import { invalidInput } from "../../platform/errors.js";
import { requireViewer } from "../identity/index.js";
import {
  createDeck, deleteDeck, getDeck, listDecks, renameDeck, setDeckCard,
} from "./service.js";

const CreateBody = z.object({
  name: z.string().trim().min(1).max(LIMITS.deckName.max),
});

const PatchBody = z.object({
  name: z.string().trim().min(1).max(LIMITS.deckName.max).optional(),
  notes: z.string().max(LIMITS.deckNotes.max).nullable().optional(),
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
    if (!viewer) throw invalidInput("Session absente.");
    return viewer.id;
  };

  const jsonBody = async (c: { req: { json: () => Promise<unknown> } }): Promise<unknown> => {
    try {
      return await c.req.json();
    } catch {
      throw invalidInput("Corps de requête illisible.");
    }
  };

  app.get("/", async (c) => c.json({ items: await listDecks(db, viewerId(c)) }));

  app.post("/", async (c) => {
    const parsed = CreateBody.safeParse(await jsonBody(c));
    if (!parsed.success) throw invalidInput("Nom de deck invalide.");
    return c.json(await createDeck(db, viewerId(c), parsed.data.name), 201);
  });

  app.get("/:id", async (c) => c.json(await getDeck(db, viewerId(c), c.req.param("id"))));

  app.patch("/:id", async (c) => {
    const parsed = PatchBody.safeParse(await jsonBody(c));
    if (!parsed.success) throw invalidInput("Données invalides.");
    await renameDeck(db, viewerId(c), c.req.param("id"), parsed.data);
    return c.json({ ok: true });
  });

  app.delete("/:id", async (c) => {
    await deleteDeck(db, viewerId(c), c.req.param("id"));
    return c.json({ ok: true });
  });

  /**
   * Pose la quantité d'une carte dans une zone.
   *
   * `PUT` et non `POST` : on déclare un état — « trois exemplaires au Main » —
   * et non un incrément. Deux requêtes identiques laissent le même deck, ce qui
   * met à l'abri du double appui sans compteur à réconcilier.
   */
  app.put("/:id/cartes", async (c) => {
    const parsed = CardBody.safeParse(await jsonBody(c));
    if (!parsed.success) throw invalidInput("Données invalides.", { issues: parsed.error.issues });
    return c.json(await setDeckCard(db, viewerId(c), c.req.param("id"), parsed.data));
  });

  return app;
}
