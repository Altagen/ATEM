import { sql } from "drizzle-orm";
import {
  bigint, check, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex,
} from "drizzle-orm/pg-core";

/** The card in the sense of the rules, identified by its passcode. Always real. */
export const cards = pgTable(
  "cards",
  {
    passcode: bigint("passcode", { mode: "number" }).primaryKey(),
    nameEn: text("name_en").notNull(),
    nameFr: text("name_fr"),
    descEn: text("desc_en"),
    descFr: text("desc_fr"),
    /**
     * These four fields stay in English: the API does not localise them, even
     * with `language=fr`. They are our filter keys, stable whatever language is
     * displayed; translation is a label table on the interface side.
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
     * A Link monster's rating and arrows. Missing from ATEM-old's schema at
     * first: Zod silently dropped the fields it did not declare, and every Link
     * card displayed “Link —”.
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
 * A printing: the card as it is physically printed.
 *
 * `cardPasscode` is **nullable**, and that is this module's central decision.
 *
 * ATEM-old signalled “printing not resolved yet” with a **negative** passcode
 * derived from a hash of the set code. The convention was implicit, copied by
 * hand into four modules as `if (cardId > 0)`, with no type-level safeguard —
 * and two different set codes could produce the same passcode through a hash
 * collision, which was tested nowhere.
 *
 * Here an unresolved printing simply has no card: the column is null and
 * `resolveStatus` says so. No fabricated card row, no number whose sign carries
 * meaning, no possible collision.
 */
export const cardPrints = pgTable(
  "card_prints",
  {
    id: serial("id").primaryKey(),
    cardPasscode: bigint("card_passcode", { mode: "number" }).references(() => cards.passcode, {
      onDelete: "set null",
    }),
    /** The code as printed on the player's card: `LTGY-FR008`. */
    setCode: text("set_code").notNull(),
    /**
     * The canonical shape, region removed: `LTGY-008`, `LOB-001`.
     *
     * It is the local join key, and it cannot be the English code. YGOPRODeck's
     * two entry points contradict each other — the dump writes `LOB-001`,
     * `cardsetsinfo.php` answers on `LOB-EN001` — and the cards themselves
     * carry one shape or the other depending on their print year. Joining on
     * the canonical shape reunites what the source separates.
     */
    canonicalSetCode: text("canonical_set_code").notNull(),
    setName: text("set_name"),
    /** Empty string rather than NULL: the unique index stays comparable. */
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
    // A resolved printing necessarily has a card; a printing without a card
    // cannot claim to be resolved. The database guarantees it, not discipline.
    check(
      "card_prints_resolved_has_card",
      sql`(${t.resolveStatus} = 'resolved') = (${t.cardPasscode} is not null)`,
    ),
  ],
);

export type CardRow = typeof cards.$inferSelect;
export type CardPrintRow = typeof cardPrints.$inferSelect;
