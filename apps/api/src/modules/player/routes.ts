/**
 * The player routes — read-only by construction (`readOnlyRoutes`).
 */
import type { Database } from "../../db/client.js";
import { invalidInput } from "../../platform/errors.js";
import { readOnlyRoutes } from "../../platform/read-only.js";
import { requireViewer } from "../identity/index.js";
import {
  getPlayerDeck, getPlayerProfile, playerCollection, playerCollectionFacets, playerDecks,
} from "./service.js";

export function playerRoutes(db: Database) {
  const app = readOnlyRoutes();
  app.use("*", requireViewer);

  app.get("/:id", async (c) => {
    const viewer = c.get("viewer");
    if (!viewer) throw invalidInput("No session.");
    return c.json(await getPlayerProfile(db, viewer.id, c.req.param("id")));
  });

  const viewerOf = (c: { get: (key: "viewer") => { id: string } | null }): string => {
    const viewer = c.get("viewer");
    if (!viewer) throw invalidInput("No session.");
    return viewer.id;
  };

  app.get("/:id/collection", async (c) =>
    c.json(await playerCollection(db, viewerOf(c), c.req.param("id"), c.req.query())));
  app.get("/:id/collection/facets", async (c) =>
    c.json(await playerCollectionFacets(db, viewerOf(c), c.req.param("id"))));
  app.get("/:id/decks", async (c) => c.json(await playerDecks(db, viewerOf(c), c.req.param("id"))));
  app.get("/:id/decks/:deckId", async (c) =>
    c.json(await getPlayerDeck(db, viewerOf(c), c.req.param("id"), c.req.param("deckId"))));

  return app;
}
