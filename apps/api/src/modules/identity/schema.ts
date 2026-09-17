import { sql } from "drizzle-orm";
import { AVATARS } from "@atem/shared";
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
    /** The discriminator shown after the display name, `#0042` style. */
    tag: text("tag").notNull(),
    role: text("role").notNull().default("member"),
    locale: text("locale").notNull().default("fr"),
    /** What the profile shows about the person, in their words. Empty until written. */
    bio: text("bio").notNull().default(""),
    /** One of the product's presets (`AVATARS`), never an uploaded image. */
    avatar: text("avatar").notNull().default("dragon"),
    /**
     * Incremented on every sign-out, password change or suspension. The token
     * carries this value; we read it back from the database on every request,
     * so a token issued before the increment stops being accepted. That is what
     * makes signing out real rather than decorative.
     */
    tokenVersion: integer("token_version").notNull().default(0),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // Case must not create two accounts: `Ange@x.fr` and `ange@x.fr` are the
    // same person to everyone but a naive index.
    uniqueIndex("users_email_uidx").on(sql`lower(${t.email})`),
    uniqueIndex("users_name_tag_uidx").on(t.displayName, t.tag),
    check("users_role_vocab", sql`${t.role} in ('member', 'admin')`),
    check("users_locale_vocab", sql`${t.locale} in ('fr', 'en')`),
    // The vocabulary comes from `@atem/shared`, the list the screen offers: one
    // list, so the picker and the database cannot disagree.
    check("users_avatar_vocab", sql`${t.avatar} in (${sql.raw(AVATARS.map((a) => `'${a}'`).join(", "))})`),
  ],
);

/**
 * Authentication attempts, for rate limiting.
 *
 * In the database rather than in memory: an in-memory counter restarts at zero
 * on restart, which hands a free reset to anyone able to cause one — or simply
 * to anyone who waits for a deployment.
 */
export const authAttempts = pgTable(
  "auth_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** The calling IP, or the targeted account: both are counted separately. */
    bucket: text("bucket").notNull(),
    action: text("action").notNull(),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("auth_attempts_lookup_idx").on(t.bucket, t.action, t.attemptedAt)],
);

export type UserRow = typeof users.$inferSelect;
