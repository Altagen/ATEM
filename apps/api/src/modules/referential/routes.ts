import { Hono } from "hono";
import type { Database } from "../../db/client.js";
import { invalidInput, notFound } from "../../platform/errors.js";
import { requireViewer } from "../identity/index.js";
import { getCard, listPrintsForCard } from "./service.js";

export function referentialRoutes(db: Database) {
  const app = new Hono();

  /**
   * Le catalogue exige une session.
   *
   * Il n'a plus qu'une route, et c'est voulu : la recherche par nom et la
   * résolution d'un set code n'existaient que pour un écran « Catalogue » qui
   * n'a jamais existé dans ATEM-old, et qui doublait une fonction que la
   * collection assure déjà. L'ajout d'une carte résout son code par
   * `POST /collection/adjust`, pas par ici.
   */
  app.use("*", requireViewer);

  /** La carte et toutes ses éditions — ce qu'affiche le bloc « Autres éditions ». */
  app.get("/cards/:passcode", async (c) => {
    const passcode = Number(c.req.param("passcode"));
    if (!Number.isInteger(passcode)) throw invalidInput("Passcode invalide.");
    const card = await getCard(db, passcode, c.get("viewer")?.locale ?? "fr");
    if (!card) throw notFound("Carte inconnue.");
    return c.json({ card, prints: await listPrintsForCard(db, passcode) });
  });

  return app;
}
