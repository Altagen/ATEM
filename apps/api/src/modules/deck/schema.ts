import { sql } from "drizzle-orm";
import {
  bigint, check, index, integer, pgTable, text, timestamp, unique, uniqueIndex, uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { DECK_MAX_COPIES } from "@atem/shared";
import { users } from "../identity/schema.js";
import { cards } from "../referential/schema.js";

/**
 * Un dossier de decks.
 *
 * Repris d'ATEM-old, **sans sa colonne `sort_order`** : elle était écrite à
 * chaque création et l'écran triait par nom de toute façon. Une colonne que
 * personne ne lit est une colonne qui ment.
 *
 * La profondeur maximale n'est pas ici : une règle qui parle du chemin complet
 * d'une ligne ne s'exprime pas dans une contrainte de colonne. Elle vit dans le
 * service, avec la détection de cycle, et ses épreuves.
 */
export const deckFolders = pgTable(
  "deck_folders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    /**
     * Le dossier parent, ou `null` à la racine.
     *
     * **Pas de `cascade`, contrairement à ATEM-old.** Son schéma cascadait
     * pendant que son service réattachait les enfants au grand-parent : deux
     * réponses contradictoires à la même question, et c'est la base qui gagne
     * dès qu'une suppression passe ailleurs que par le service. Ici la base ne
     * répond rien — c'est la transaction du service qui réattache, et elle est
     * la seule à le faire.
     */
    parentId: uuid("parent_id").references((): AnyPgColumn => deckFolders.id),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("deck_folders_user_idx").on(t.userId, t.parentId),
    /**
     * Deux dossiers frères du même nom sont indiscernables dans un explorateur.
     *
     * `nulls not distinct` parce que la racine est un `parent_id` nul : sans
     * lui, Postgres considère deux nuls comme différents et la règle ne
     * s'appliquerait **qu'aux sous-dossiers** — c'est-à-dire pas là où l'on
     * crée le plus.
     */
    unique("deck_folders_sibling_name_uidx").on(t.userId, t.parentId, t.name).nullsNotDistinct(),
  ],
);

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
    /**
     * Le dossier qui le range, ou `null` à la racine.
     *
     * `set null` : un dossier effacé par un chemin qui ne passerait pas par le
     * service laisse ses decks à la racine. Perdre le rangement est réparable,
     * perdre les decks ne l'est pas.
     */
    folderId: uuid("folder_id").references(() => deckFolders.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("decks_user_idx").on(t.userId, t.updatedAt),
    index("decks_user_folder_idx").on(t.userId, t.folderId),
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
export type DeckFolderRow = typeof deckFolders.$inferSelect;
