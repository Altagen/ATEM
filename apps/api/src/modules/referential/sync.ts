/**
 * Importing the full catalogue.
 *
 * Two requests are enough — measured on 2026-09-09: 14,524 cards in English
 * (21 MB, 22 s) and 11,661 in French. We stay far below the 20-requests-per-
 * second limit.
 *
 * Insertion happens in batches. ATEM-old chained tens of thousands of
 * sequential `await`s — minutes for seconds of work.
 */
import { sql } from "drizzle-orm";
import { canonicalSetCode, languageFromSetCode, normalizeSetCode, parseSetCode } from "@atem/shared";
import type { Database } from "../../db/client.js";
import { createDatabase } from "../../db/client.js";
import { cardPrints, cards } from "./schema.js";
import { cardFromYgo } from "./service.js";
import { fetchAllCards, type YgoCard } from "./ygoprodeck.js";

const BATCH = 500;

const excluded = (column: string) => sql.raw(`excluded.${column}`);

/**
 * Keeps what we knew when the new value is missing.
 *
 * Both dumps are downloaded in parallel, and `fetchAllCards` returns an empty
 * array — not an error — when the API answers 400 or returns `{error}`. If the
 * French dump degrades that way while the English one succeeds, every card is
 * written back with `name_fr: null`: **every translation wiped at once**, with
 * the log announcing a success.
 */
const keepKnown = (column: string) =>
  sql.raw(`coalesce(excluded.${column}, "cards".${column})`);

/**
 * The printings of the dump, de-duplicated — and **contested ones settled**.
 *
 * Two things make a printing appear twice:
 *
 * - the same `(set_code, rarity, language)` listed twice, which PostgreSQL
 *   refuses inside one `ON CONFLICT` batch;
 * - **two different cards claiming the same printing**. YGOPRODeck registers an
 *   alternate artwork as its own card with its own passcode, and both entries
 *   carry the set codes of the original print. Taking the last one seen made the
 *   result depend on the dump's order: on 2026-09-19 `LOB-FR001` — the 2002
 *   Blue-Eyes — ended up on passcode 89631146, the alternate art, whose single
 *   printing then hid the sheet's “other printings” block.
 *
 * The lowest passcode wins: a re-registration is always given a higher one than
 * the card it re-registers. That is a rule of the source's making, not of ours,
 * but it is stable and it can be read here.
 */
export function printRowsFrom(cards: YgoCard[]): {
  rows: (typeof cardPrints.$inferInsert)[];
  malformed: number;
} {
  const rows = new Map<string, typeof cardPrints.$inferInsert>();
  let malformed = 0;

  for (const card of cards) {
    for (const set of card.card_sets ?? []) {
      const setCode = normalizeSetCode(set.set_code);
      // 12 entries out of 44,517 have no dash (`DB13`, `DB5`). They are
      // malformed on YGOPRODeck's side: we count them and leave them.
      if (!parseSetCode(setCode)) {
        malformed += 1;
        continue;
      }
      const rarity = set.set_rarity?.trim() ?? "";
      const language = languageFromSetCode(setCode);
      const key = `${setCode}|${rarity}|${language}`;
      const held = rows.get(key);
      if (held && (held.cardPasscode ?? Number.MAX_SAFE_INTEGER) <= card.id) continue;
      rows.set(key, {
        setCode,
        canonicalSetCode: canonicalSetCode(setCode),
        cardPasscode: card.id,
        setName: set.set_name ?? null,
        rarity,
        language,
        resolveStatus: "resolved",
      });
    }
  }
  return { rows: [...rows.values()], malformed };
}

export async function syncCatalogue(db: Database): Promise<void> {
  console.log("[atem] downloading the catalogue…");
  const [en, fr] = await Promise.all([fetchAllCards(), fetchAllCards("fr")]);
  console.log(`[atem] ${en.length} cards in English, ${fr.length} in French`);

  // An empty dump is not an empty catalogue: it is an answer we failed to
  // read. Carrying on would write that absence into the database.
  if (en.length === 0) throw new Error("the English dump is empty — import cancelled");
  if (fr.length === 0) throw new Error("the French dump is empty — import cancelled");

  const frByPasscode = new Map(fr.map((card) => [card.id, card]));
  const cardRows = en.map((card) => cardFromYgo(card, frByPasscode.get(card.id) ?? null));

  for (let i = 0; i < cardRows.length; i += BATCH) {
    await db
      .insert(cards)
      .values(cardRows.slice(i, i + BATCH))
      .onConflictDoUpdate({
        target: cards.passcode,
        set: {
          nameEn: excluded("name_en"),
          nameFr: keepKnown("name_fr"),
          descEn: excluded("desc_en"),
          descFr: keepKnown("desc_fr"),
          type: excluded("type"),
          frameType: excluded("frame_type"),
          race: excluded("race"),
          attribute: excluded("attribute"),
          atk: excluded("atk"),
          def: excluded("def"),
          level: excluded("level"),
          scale: excluded("scale"),
          linkValue: excluded("link_value"),
          linkMarkers: excluded("link_markers"),
          archetype: excluded("archetype"),
          banlistTcg: excluded("banlist_tcg"),
          imageUrl: excluded("image_url"),
          imageUrlSmall: excluded("image_url_small"),
          updatedAt: new Date(),
        },
      });
  }
  console.log(`[atem] ${cardRows.length} cards saved`);

  const { rows: prints, malformed } = printRowsFrom(en);
  for (let i = 0; i < prints.length; i += BATCH) {
    await db
      .insert(cardPrints)
      .values(prints.slice(i, i + BATCH))
      .onConflictDoUpdate({
        target: [cardPrints.setCode, cardPrints.rarity, cardPrints.language],
        set: {
          cardPasscode: excluded("card_passcode"),
          canonicalSetCode: excluded("canonical_set_code"),
          setName: excluded("set_name"),
          resolveStatus: excluded("resolve_status"),
          updatedAt: new Date(),
        },
      });
  }
  console.log(
    `[atem] ${prints.length} printings saved` +
      (malformed > 0 ? ` (${malformed} malformed codes ignored)` : ""),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { db, sql: connection } = createDatabase();
  await syncCatalogue(db);
  await connection.end();
}
