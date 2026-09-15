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
  createDeck, deleteDeck, getDeck, listDecks, setDeckCard, updateDeck,
} from "./service.js";
import { createFolder, deleteFolder, listFolders, updateFolder } from "./folders.js";

const CreateBody = z.object({
  name: z.string().trim().min(1).max(LIMITS.deckName.max),
  folderId: z.string().uuid().nullable().optional(),
});

const PatchBody = z.object({
  name: z.string().trim().min(1).max(LIMITS.deckName.max).optional(),
  /** `null` remet le deck à la racine ; absent ne touche pas au rangement. */
  folderId: z.string().uuid().nullable().optional(),
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
   * Les dossiers, **avant** `/:id`.
   *
   * Hono essaie les routes dans l'ordre où on les déclare : plus bas,
   * `/dossiers` serait avalé par `/:id`, qui répondrait « identifiant
   * invalide » pour une liste de dossiers. Une épreuve tient cet ordre, parce
   * qu'un déplacement de quelques lignes suffirait à le défaire sans bruit.
   */
  app.get("/dossiers", async (c) => c.json({ items: await listFolders(db, viewerId(c)) }));

  app.post("/dossiers", async (c) => {
    const parsed = FolderBody.safeParse(await jsonBody(c));
    if (!parsed.success) throw invalidInput("Invalid folder name.");
    return c.json(await createFolder(db, viewerId(c), parsed.data), 201);
  });

  app.patch("/dossiers/:id", async (c) => {
    const parsed = FolderPatchBody.safeParse(await jsonBody(c));
    if (!parsed.success) throw invalidInput("Invalid data.");
    return c.json(await updateFolder(db, viewerId(c), c.req.param("id"), parsed.data));
  });

  app.delete("/dossiers/:id", async (c) => {
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
   * Pose la quantité d'une carte dans une zone.
   *
   * `PUT` et non `POST` : on déclare un état — « trois exemplaires au Main » —
   * et non un incrément. Deux requêtes identiques laissent le même deck, ce qui
   * met à l'abri du double appui sans compteur à réconcilier.
   */
  app.put("/:id/cartes", async (c) => {
    const parsed = CardBody.safeParse(await jsonBody(c));
    if (!parsed.success) throw invalidInput("Invalid data.", { issues: parsed.error.issues });
    return c.json(await setDeckCard(db, viewerId(c), c.req.param("id"), parsed.data));
  });

  return app;
}
