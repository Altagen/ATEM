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
   * Le catalogue exige une session.
   *
   * Il reste volontairement pauvre : la recherche par nom a été retirée avec
   * l'écran « Catalogue », qui n'existait pas dans ATEM-old et doublait une
   * fonction que la collection assure déjà. Ajouter une carte à la collection
   * résout son code par `POST /collection/adjust`, pas par ici.
   */
  app.use("*", requireViewer);

  /**
   * Le nom d'une carte, à partir de son set code — **sans rien inscrire nulle
   * part**.
   *
   * C'est ce dont la scanliste a besoin : elle inventorie un lot sans le verser,
   * et doit pouvoir afficher « Grande Baleine » plutôt que « LTGY-FR008 ». Elle
   * ne peut pas passer par `POST /collection/adjust`, qui ajouterait la carte à
   * la collection — c'est précisément ce qu'elle refuse de faire.
   *
   * La résolution peut enrichir le référentiel au passage : c'est sa raison
   * d'être, et c'est partagé par tout le monde. Ce qu'elle ne touche jamais,
   * c'est l'inventaire de qui que ce soit.
   */
  app.get("/impressions/:setCode", async (c) => {
    const setCode = c.req.param("setCode");
    if (!setCode) throw invalidInput("Set code vide.");

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
