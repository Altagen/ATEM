/**
 * L'import du catalogue complet.
 *
 * Deux requêtes suffisent — mesuré le 2026-09-09 : 14 524 cartes en anglais
 * (21 Mo, 22 s) et 11 661 en français. On reste très loin des 20 requêtes par
 * seconde de la limite.
 *
 * L'insertion se fait par lots. ATEM-old enchaînait des dizaines de milliers
 * d'`await` séquentiels — des minutes pour un travail de secondes.
 */
import { sql } from "drizzle-orm";
import { canonicalSetCode, languageFromSetCode, normalizeSetCode, parseSetCode } from "@atem/shared";
import type { Database } from "../../db/client.js";
import { createDatabase } from "../../db/client.js";
import { cardPrints, cards } from "./schema.js";
import { cardFromYgo } from "./service.js";
import { fetchAllCards } from "./ygoprodeck.js";

const BATCH = 500;

const excluded = (column: string) => sql.raw(`excluded.${column}`);

/**
 * Garde ce qu'on savait quand la nouvelle valeur est absente.
 *
 * Les deux dumps sont téléchargés en parallèle, et `fetchAllCards` rend un
 * tableau vide — pas une erreur — quand l'API répond 400 ou renvoie `{error}`.
 * Si le dump français dégrade ainsi pendant que l'anglais réussit, chaque carte
 * repart avec `name_fr: null` : **toutes les traductions effacées d'un coup**,
 * et le journal annonçant un succès.
 */
const keepKnown = (column: string) =>
  sql.raw(`coalesce(excluded.${column}, "cards".${column})`);

export async function syncCatalogue(db: Database): Promise<void> {
  console.log("[atem] téléchargement du catalogue…");
  const [en, fr] = await Promise.all([fetchAllCards(), fetchAllCards("fr")]);
  console.log(`[atem] ${en.length} cartes en anglais, ${fr.length} en français`);

  // Un dump vide n'est pas un catalogue vide : c'est une réponse qu'on n'a pas
  // su lire. Continuer écrirait cette absence dans la base.
  if (en.length === 0) throw new Error("le dump anglais est vide — import annulé");
  if (fr.length === 0) throw new Error("le dump français est vide — import annulé");

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
  console.log(`[atem] ${cardRows.length} cartes enregistrées`);

  /**
   * Une même identité `(set_code, rarity, language)` peut apparaître deux fois
   * dans le dump. On dédoublonne avant d'insérer : PostgreSQL refuse un
   * `ON CONFLICT` dont le lot contient lui-même deux fois la même clé.
   */
  const printRows = new Map<string, typeof cardPrints.$inferInsert>();
  let malformed = 0;

  for (const card of en) {
    for (const set of card.card_sets ?? []) {
      const setCode = normalizeSetCode(set.set_code);
      // 12 entrées sur 44 517 n'ont pas de tiret (`DB13`, `DB5`). Elles sont
      // malformées côté YGOPRODeck : on les compte et on les laisse.
      if (!parseSetCode(setCode)) {
        malformed += 1;
        continue;
      }
      const rarity = set.set_rarity?.trim() ?? "";
      const language = languageFromSetCode(setCode);
      printRows.set(`${setCode}|${rarity}|${language}`, {
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

  const prints = [...printRows.values()];
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
    `[atem] ${prints.length} impressions enregistrées` +
      (malformed > 0 ? ` (${malformed} codes malformés ignorés)` : ""),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { db, sql: connection } = createDatabase();
  await syncCatalogue(db);
  await connection.end();
}
