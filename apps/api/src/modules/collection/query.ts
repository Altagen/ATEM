/**
 * The collection's list query, read from a URL.
 *
 * Shared by the owner's route and by `player`'s read-only one, so the filters a
 * visitor can use are exactly the owner's — one parser, not two that drift.
 */
import { z } from "zod";
import { invalidInput } from "../../platform/errors.js";
import type { CollectionFilters } from "./service.js";

/** A list sent as `?type=a&type=b` or `?type=a,b` — both are accepted. */
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

export function collectionQuery(raw: Record<string, string>): CollectionFilters {
  const parsed = ListQuery.safeParse(raw);
  if (!parsed.success) throw invalidInput("Invalid filters.", { issues: parsed.error.issues });
  const q = parsed.data;
  return {
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
  };
}
