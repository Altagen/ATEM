import {
  boolean, index, integer, pgTable, serial, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import { cardPrints } from "../referential/schema.js";
import { users } from "../identity/schema.js";

/**
 * Un exemplaire possédé.
 *
 * L'unité est l'**impression**, pas la carte : le joueur scanne un set code, il
 * déclare posséder une édition précise. Le « +1 / −1 » d'une ligne agit donc sur
 * l'édition, et deux éditions de la même carte sont deux lignes.
 */
export const ownedCards = pgTable(
  "owned_cards",
  {
    id: serial("id").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    printId: integer("print_id").notNull().references(() => cardPrints.id, { onDelete: "restrict" }),
    /**
     * Le set code est recopié ici, alors qu'il vit déjà sur l'impression.
     *
     * C'est ce que le joueur a réellement lu sur sa carte, et c'est ce que
     * l'export doit lui rendre — même si l'impression n'a jamais été résolue,
     * même si le catalogue change d'avis plus tard. La vérité de l'inventaire
     * appartient à l'inventaire.
     */
    setCode: text("set_code").notNull(),
    quantity: integer("quantity").notNull().default(1),
    isFavorite: boolean("is_favorite").notNull().default(false),
    notes: text("notes"),
    addedAt: timestamp("added_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("owned_cards_user_print_uidx").on(t.userId, t.printId),
    index("owned_cards_user_idx").on(t.userId),
    index("owned_cards_user_favorite_idx").on(t.userId, t.isFavorite),
    index("owned_cards_set_code_idx").on(t.setCode),
  ],
);
