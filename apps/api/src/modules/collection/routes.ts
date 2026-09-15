import { Hono } from "hono";
import { z } from "zod";
import { LIMITS } from "@atem/shared";
import type { Database } from "../../db/client.js";
import { invalidInput } from "../../platform/errors.js";
import { requireViewer } from "../identity/index.js";
import {
  adjustQuantity, collectionFacets, listCollection, resolveStatus, setFavorite, setNotes,
} from "./service.js";

/** Une liste envoyée en `?type=a&type=b` ou `?type=a,b` — les deux sont acceptées. */
const csvList = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((value) => {
    if (!value) return undefined;
    const parts = (Array.isArray(value) ? value : [value]).flatMap((v) => v.split(","));
    const cleaned = parts.map((v) => v.trim()).filter(Boolean);
    return cleaned.length > 0 ? cleaned : undefined;
  });

const ListQuery = z.object({
  q: z.string().max(120).optional(),
  type: csvList,
  race: csvList,
  frameType: csvList,
  attribute: csvList,
  archetype: z.string().max(80).optional(),
  language: z.string().max(5).optional(),
  rarity: z.string().max(60).optional(),
  level: csvList,
  rank: csvList,
  link: csvList,
  atkMin: z.coerce.number().int().min(0).optional(),
  atkMax: z.coerce.number().int().min(0).optional(),
  kind: z.enum(["monster", "spell", "trap"]).optional(),
  favorites: z.enum(["1", "0"]).optional(),
  unresolved: z.enum(["1", "0"]).optional(),
  sort: z.enum(["name", "recent", "quantity", "setCode"]).optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const AdjustBody = z.object({
  setCode: z.string().min(1).max(LIMITS.setCode.max),
  delta: z.number().int().min(-LIMITS.quantity.max).max(LIMITS.quantity.max),
  language: z.string().max(5).nullish(),
  /**
   * Le passcode, s'il est connu : les huit chiffres en bas à gauche de la
   * carte. Quand il est fourni, l'impression n'a pas à attendre d'être
   * identifiée — on sait déjà de quelle carte il s'agit.
   */
  passcode: z.number().int().positive().nullish(),
});

export function collectionRoutes(db: Database) {
  const app = new Hono();
  app.use("*", requireViewer);

  const viewerId = (c: { get: (key: "viewer") => { id: string } | null }): string => {
    const viewer = c.get("viewer");
    if (!viewer) throw invalidInput("No session.");
    return viewer.id;
  };

  app.get("/", async (c) => {
    const parsed = ListQuery.safeParse(c.req.query());
    if (!parsed.success) throw invalidInput("Invalid filters.", { issues: parsed.error.issues });
    const q = parsed.data;

    return c.json(
      await listCollection(db, viewerId(c), {
        query: q.q,
        type: q.type,
        race: q.race,
        frameType: q.frameType,
        attribute: q.attribute,
        archetype: q.archetype,
        language: q.language,
        rarity: q.rarity,
        levels: q.level,
        ranks: q.rank,
        links: q.link,
        atk: { min: q.atkMin, max: q.atkMax },
        kind: q.kind,
        favoritesOnly: q.favorites === "1",
        unresolvedOnly: q.unresolved === "1",
        sort: q.sort,
        sortDir: q.sortDir,
        limit: q.limit,
        offset: q.offset,
      }),
    );
  });

  app.get("/facets", async (c) => c.json(await collectionFacets(db, viewerId(c))));

  app.get("/resolve-status", async (c) => c.json(await resolveStatus(db, viewerId(c))));

  /** Le « +1 » et le « −1 » du scan comme de la grille. */
  app.post("/adjust", async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw invalidInput("Unreadable request body.");
    }
    const parsed = AdjustBody.safeParse(raw);
    if (!parsed.success) throw invalidInput("Invalid data.", { issues: parsed.error.issues });

    return c.json({ item: await adjustQuantity(db, viewerId(c), parsed.data) });
  });

  app.patch("/:id/notes", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) throw invalidInput("Invalid identifier.");

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw invalidInput("Unreadable request body.");
    }
    const parsed = z
      .object({ notes: z.string().max(LIMITS.note.max).nullable() })
      .safeParse(raw);
    if (!parsed.success) throw invalidInput("Invalid data.");

    await setNotes(db, viewerId(c), id, parsed.data.notes);
    return c.json({ ok: true });
  });

  app.patch("/:id/favorite", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) throw invalidInput("Invalid identifier.");

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw invalidInput("Unreadable request body.");
    }
    const parsed = z.object({ isFavorite: z.boolean() }).safeParse(raw);
    if (!parsed.success) throw invalidInput("Invalid data.");

    await setFavorite(db, viewerId(c), id, parsed.data.isFavorite);
    return c.json({ ok: true });
  });

  return app;
}
