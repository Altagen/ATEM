import { sql } from "drizzle-orm";
import {
  bigint, check, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex,
} from "drizzle-orm/pg-core";

/** La carte au sens des règles, identifiée par son passcode. Toujours réelle. */
export const cards = pgTable(
  "cards",
  {
    passcode: bigint("passcode", { mode: "number" }).primaryKey(),
    nameEn: text("name_en").notNull(),
    nameFr: text("name_fr"),
    descEn: text("desc_en"),
    descFr: text("desc_fr"),
    /**
     * Ces quatre champs restent en anglais : l'API ne les localise pas, même en
     * `language=fr`. Ce sont nos clés de filtre, stables quelle que soit la
     * langue affichée ; la traduction est une table de libellés côté interface.
     */
    type: text("type"),
    frameType: text("frame_type"),
    race: text("race"),
    attribute: text("attribute"),
    atk: integer("atk"),
    def: integer("def"),
    level: integer("level"),
    scale: integer("scale"),
    /**
     * Rang et flèches d'un monstre Lien. Absents du schéma d'ATEM-old à
     * l'origine : Zod retirait silencieusement les champs qu'il ne déclarait
     * pas, et toutes les cartes Lien affichaient « Lien — ».
     */
    linkValue: integer("link_value"),
    linkMarkers: jsonb("link_markers").$type<string[]>(),
    archetype: text("archetype"),
    banlistTcg: text("banlist_tcg"),
    imageUrl: text("image_url"),
    imageUrlSmall: text("image_url_small"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("cards_name_en_idx").on(t.nameEn),
    index("cards_name_fr_idx").on(t.nameFr),
    index("cards_archetype_idx").on(t.archetype),
  ],
);

/**
 * Une impression : la carte telle qu'elle est physiquement imprimée.
 *
 * `cardPasscode` est **nullable**, et c'est la décision centrale de ce module.
 *
 * ATEM-old signalait « impression pas encore résolue » par un passcode
 * **négatif** dérivé d'un hachage du set code. La convention était implicite,
 * recopiée à la main dans quatre modules sous la forme `if (cardId > 0)`, sans
 * garde-fou de type — et deux set codes différents pouvaient produire le même
 * passcode par collision de hachage, ce qui n'était testé nulle part.
 *
 * Ici, une impression non résolue n'a simplement pas de carte : la colonne est
 * nulle et `resolveStatus` le dit. Aucune ligne de carte fabriquée, aucun
 * nombre dont le signe porte un sens, aucune collision possible.
 */
export const cardPrints = pgTable(
  "card_prints",
  {
    id: serial("id").primaryKey(),
    cardPasscode: bigint("card_passcode", { mode: "number" }).references(() => cards.passcode, {
      onDelete: "set null",
    }),
    /** Le code tel qu'imprimé sur la carte du joueur : `LTGY-FR008`. */
    setCode: text("set_code").notNull(),
    /**
     * La forme canonique, région retirée : `LTGY-008`, `LOB-001`.
     *
     * C'est la clé de jointure locale, et elle ne peut pas être le code anglais.
     * Les deux points d'entrée de YGOPRODeck se contredisent — le dump écrit
     * `LOB-001`, `cardsetsinfo.php` répond sur `LOB-EN001` — et les cartes
     * elles-mêmes portent l'une ou l'autre forme selon leur année d'impression.
     * Joindre sur la forme canonique réunit ce que la source sépare.
     */
    canonicalSetCode: text("canonical_set_code").notNull(),
    setName: text("set_name"),
    /** Chaîne vide plutôt que NULL : l'index unique reste comparable. */
    rarity: text("rarity").notNull().default(""),
    language: text("language").notNull().default("en"),
    resolveStatus: text("resolve_status").notNull().default("pending"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("card_prints_identity_uidx").on(t.setCode, t.rarity, t.language),
    index("card_prints_canonical_idx").on(t.canonicalSetCode),
    index("card_prints_card_idx").on(t.cardPasscode),
    check(
      "card_prints_status_vocab",
      sql`${t.resolveStatus} in ('resolved', 'pending', 'unidentified')`,
    ),
    // Une impression résolue a forcément une carte ; une impression sans carte
    // ne peut pas se prétendre résolue. La base le garantit, pas la discipline.
    check(
      "card_prints_resolved_has_card",
      sql`(${t.resolveStatus} = 'resolved') = (${t.cardPasscode} is not null)`,
    ),
  ],
);

export type CardRow = typeof cards.$inferSelect;
export type CardPrintRow = typeof cardPrints.$inferSelect;
