import { sql } from "drizzle-orm";
import {
  check, index, integer, pgTable, serial, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import { LIMITS } from "@atem/shared";
import { users } from "../identity/schema.js";

/**
 * Un lot inventorié, indépendant de la collection.
 *
 * `pouredAt` porte tout l'état : nul, le lot attend ; daté, il est entré en
 * collection. Un booléen aurait dit la même chose en perdant la seule
 * information qu'on redemande vraiment — **quand**.
 */
export const scanlists = pgTable(
  "scanlists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    pouredAt: timestamp("poured_at", { withTimezone: true }),
  },
  (t) => [index("scanlists_user_idx").on(t.userId, t.createdAt)],
);

/**
 * Une ligne de lot.
 *
 * Elle ne référence **aucune impression**. C'est délibéré : un lot est ce qu'on
 * a lu sur des cartons, pas ce que le catalogue en pense. Le code peut être
 * inconnu, mal lu, ou pointer une édition que YGOPRODeck n'indexe pas — la
 * ligne doit exister quand même, et c'est le versement qui fera le raccord.
 *
 * Le nom et le passcode sont recopiés tels qu'ils étaient au scan, pour que la
 * liste se relise identique dans six mois.
 */
export const scanlistLines = pgTable(
  "scanlist_lines",
  {
    id: serial("id").primaryKey(),
    scanlistId: uuid("scanlist_id")
      .notNull()
      .references(() => scanlists.id, { onDelete: "cascade" }),
    setCode: text("set_code").notNull(),
    name: text("name"),
    passcode: integer("passcode"),
    quantity: integer("quantity").notNull(),
  },
  (t) => [
    // Un code n'apparaît qu'une fois par lot : c'est un compteur, pas un journal.
    uniqueIndex("scanlist_lines_list_code_uidx").on(t.scanlistId, t.setCode),
    /**
     * Une ligne enregistrée compte au moins un exemplaire.
     *
     * Le zéro existe pendant qu'on scanne — c'est le plancher du « −1 », et il
     * montre ce qu'on vient d'annuler — mais il ne s'enregistre pas : une ligne
     * qui déclare zéro exemplaire ne dit rien. Le plafond, lui, empêche qu'un
     * fichier bricolé fasse entrer un nombre arbitraire dans la collection au
     * versement.
     */
    check(
      "scanlist_lines_quantity_ck",
      sql`${t.quantity} between 1 and ${sql.raw(String(LIMITS.quantity.max))}`,
    ),
  ],
);

export type ScanlistRow = typeof scanlists.$inferSelect;
