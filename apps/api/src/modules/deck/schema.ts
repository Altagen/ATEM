import { sql } from "drizzle-orm";
import {
  bigint, check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import { DECK_MAX_COPIES } from "@atem/shared";
import { users } from "../identity/schema.js";
import { cards } from "../referential/schema.js";

/**
 * Un deck.
 *
 * Reprise de la coquille d'ATEM-old, **sans sa colonne `category`** : elle y
 * était marquée `@deprecated` et pourtant recalculée à chaque écriture. Une
 * dette qui travaille est pire qu'une dette qui dort.
 */
export const decks = pgTable(
  "decks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("decks_user_idx").on(t.userId, t.updatedAt),
    // Deux decks du même nom chez la même personne sont impossibles à
    // distinguer dans une liste — et la confirmation de suppression se tape au
    // nom.
    uniqueIndex("decks_user_name_uidx").on(t.userId, t.name),
  ],
);

/**
 * Une carte d'un deck — **une ligne par carte, pas par impression**.
 *
 * C'est la règle du jeu : trois Dragons Blancs en trois codes d'extension
 * restent trois Dragons Blancs. Et c'est ce qui rend le plafond exprimable.
 *
 * ATEM-old identifiait ses lignes par `(deck, zone, passcode, set_code)`. La
 * même carte vivait donc sur plusieurs lignes — zones différentes, impression
 * épinglée différente — et totalisait six exemplaires sans qu'aucune contrainte
 * n'agrège. Son plafond était vérifié **par ligne**, en Zod et dans le service,
 * ce qui ne garantissait rien.
 *
 * Ici les trois zones sont trois colonnes de la même ligne. La contrainte porte
 * sur leur somme, et la base refuse le quatrième exemplaire quoi qu'il arrive —
 * même si un jour un service oublie de demander.
 */
export const deckCards = pgTable(
  "deck_cards",
  {
    deckId: uuid("deck_id").notNull().references(() => decks.id, { onDelete: "cascade" }),
    /**
     * `restrict` : le catalogue ne s'efface pas sous un deck qui s'en sert.
     * Il est importé en bloc et n'est jamais nettoyé, donc ça ne gêne rien —
     * mais l'écrire dit que la dépendance est voulue.
     */
    passcode: bigint("passcode", { mode: "number" })
      .notNull()
      .references(() => cards.passcode, { onDelete: "restrict" }),
    mainQty: integer("main_qty").notNull().default(0),
    extraQty: integer("extra_qty").notNull().default(0),
    sideQty: integer("side_qty").notNull().default(0),
  },
  (t) => [
    uniqueIndex("deck_cards_identity_uidx").on(t.deckId, t.passcode),
    index("deck_cards_passcode_idx").on(t.passcode),
    /**
     * Le plafond des trois exemplaires, pour tout le deck.
     *
     * Il ne dépend ni de la banlist ni de la date : c'est la règle du jeu, et
     * elle ne changera pas. C'est pour ça qu'elle vit ici et non dans du code
     * qu'on pourrait oublier d'appeler — la banlist, elle, bouge avec le
     * catalogue et reste au service.
     */
    check(
      "deck_cards_max_copies_ck",
      sql`${t.mainQty} + ${t.extraQty} + ${t.sideQty} between 0 and ${sql.raw(String(DECK_MAX_COPIES))}`,
    ),
    // Aucune zone ne descend sous zéro : un « −1 » de trop ne fabrique pas une
    // quantité négative qui fausserait tous les totaux.
    check(
      "deck_cards_non_negative_ck",
      sql`${t.mainQty} >= 0 and ${t.extraQty} >= 0 and ${t.sideQty} >= 0`,
    ),
  ],
);

export type DeckRow = typeof decks.$inferSelect;
