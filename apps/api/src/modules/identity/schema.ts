import { sql } from "drizzle-orm";
import {
  check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name").notNull(),
    /** Le discriminant affiché derrière le pseudo, façon `#0042`. */
    tag: text("tag").notNull(),
    role: text("role").notNull().default("member"),
    locale: text("locale").notNull().default("fr"),
    /**
     * Incrémenté à chaque déconnexion, changement de mot de passe ou suspension.
     * Le jeton porte cette valeur ; on la relit en base à chaque requête, donc
     * un jeton émis avant l'incrément cesse d'être accepté. C'est ce qui rend la
     * déconnexion réelle plutôt que décorative.
     */
    tokenVersion: integer("token_version").notNull().default(0),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // La casse ne doit pas créer deux comptes : `Ange@x.fr` et `ange@x.fr` sont
    // la même personne pour tout le monde sauf pour un index naïf.
    uniqueIndex("users_email_uidx").on(sql`lower(${t.email})`),
    uniqueIndex("users_name_tag_uidx").on(t.displayName, t.tag),
    check("users_role_vocab", sql`${t.role} in ('member', 'admin')`),
    check("users_locale_vocab", sql`${t.locale} in ('fr', 'en')`),
  ],
);

/**
 * Les tentatives d'authentification, pour la limitation de débit.
 *
 * En base plutôt qu'en mémoire : un compteur en mémoire repart à zéro au
 * redémarrage, ce qui offre une remise à zéro gratuite à qui sait provoquer un
 * redémarrage — ou simplement à qui attend un déploiement.
 */
export const authAttempts = pgTable(
  "auth_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** L'IP appelante, ou le compte visé : les deux sont comptés séparément. */
    bucket: text("bucket").notNull(),
    action: text("action").notNull(),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("auth_attempts_lookup_idx").on(t.bucket, t.action, t.attemptedAt)],
);

export type UserRow = typeof users.$inferSelect;
