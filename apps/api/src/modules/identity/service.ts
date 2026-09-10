/**
 * Le module identity — comptes et sessions.
 *
 * Aucun autre module ne lit la table `users` : ils passent par `getPublicUser`.
 */
import { eq, sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { conflict, invalidInput, notFound, unauthorized } from "../../platform/errors.js";
import { checkPasswordStrength } from "@atem/shared";
import { hashPassword, needsRehash, verifyPassword } from "./password.js";
import { users, type UserRow } from "./schema.js";

export type PublicUser = {
  id: string;
  displayName: string;
  tag: string;
  locale: string;
  role: string;
  createdAt: Date;
};

const toPublic = (row: UserRow): PublicUser => ({
  id: row.id,
  displayName: row.displayName,
  tag: row.tag,
  locale: row.locale,
  role: row.role,
  createdAt: row.createdAt,
});

/** Quatre chiffres, façon `#0042`. Retenté en cas de collision. */
const randomTag = () => String(Math.floor(Math.random() * 10000)).padStart(4, "0");

export async function registerUser(
  db: Database,
  input: { email: string; password: string; displayName: string },
): Promise<{ user: PublicUser; tokenVersion: number }> {
  /**
   * La règle vient de `@atem/shared`, la même fonction que l'écran utilise pour
   * dessiner sa jauge. ATEM-old en avait quatre copies divergentes, et l'une
   * d'elles approuvait des mots de passe que le serveur refusait ensuite.
   */
  const strength = checkPasswordStrength(input.password);
  if (!strength.isValid) {
    throw invalidInput(
      "Le mot de passe doit faire au moins 16 caractères et contenir une " +
        "majuscule, une minuscule, un chiffre et un caractère spécial.",
      {
        hasMinLength: strength.hasMinLength,
        hasUpper: strength.hasUpper,
        hasLower: strength.hasLower,
        hasDigit: strength.hasDigit,
        hasSpecial: strength.hasSpecial,
      },
    );
  }

  const email = input.email.trim();
  const displayName = input.displayName.trim();
  if (!email.includes("@")) throw invalidInput("Adresse email invalide.");
  if (displayName.length < 2) throw invalidInput("Le pseudo doit faire au moins 2 caractères.");

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`)
    .limit(1);
  if (existing) throw conflict("Cette adresse email est déjà utilisée.");

  const passwordHash = await hashPassword(input.password);

  // Le couple (pseudo, discriminant) est unique : on retente sur collision
  // plutôt que de refuser un pseudo déjà porté par quelqu'un d'autre.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const [row] = await db
        .insert(users)
        .values({ email, passwordHash, displayName, tag: randomTag() })
        .returning();
      if (!row) throw new Error("insertion sans résultat");
      return { user: toPublic(row), tokenVersion: row.tokenVersion };
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (!message.includes("users_name_tag_uidx")) throw err;
    }
  }
  throw conflict("Ce pseudo est trop demandé, essayez-en un autre.");
}

export async function authenticate(
  db: Database,
  input: { email: string; password: string },
): Promise<{ user: PublicUser; tokenVersion: number }> {
  const [row] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = lower(${input.email.trim()})`)
    .limit(1);

  // Message identique dans les deux cas : distinguer « compte inconnu » de
  // « mot de passe faux » révélerait quelles adresses ont un compte ici.
  const invalid = unauthorized("Adresse email ou mot de passe incorrect.");
  if (!row) {
    // On hache quand même, pour que la réponse prenne le même temps.
    await hashPassword(input.password);
    throw invalid;
  }
  if (!(await verifyPassword(input.password, row.passwordHash))) throw invalid;
  if (row.suspendedAt) throw unauthorized("Ce compte est suspendu.");

  // Le mot de passe en clair n'est disponible qu'ici : c'est le seul moment où
  // un hachage produit sous un coût dépassé peut être refait.
  if (needsRehash(row.passwordHash)) {
    const fresh = await hashPassword(input.password);
    await db.update(users).set({ passwordHash: fresh }).where(eq(users.id, row.id));
  }

  return { user: toPublic(row), tokenVersion: row.tokenVersion };
}

/** Invalide tous les jetons émis pour ce compte. */
export async function revokeSessions(db: Database, userId: string): Promise<void> {
  await db
    .update(users)
    .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
    .where(eq(users.id, userId));
}

export async function getPublicUser(db: Database, userId: string): Promise<PublicUser> {
  const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!row) throw notFound("Utilisateur introuvable.");
  return toPublic(row);
}
