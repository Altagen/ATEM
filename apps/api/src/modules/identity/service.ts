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
import { authAttempts, users, type UserRow } from "./schema.js";

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
      // Une seule chaîne, et non deux concaténées : c'est elle que le front
      // cherche au dictionnaire pour la rendre en anglais.
      "The password must be at least 16 characters long and contain an uppercase letter, a lowercase letter, a digit and a special character.",
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
  if (!email.includes("@")) throw invalidInput("Invalid email address.");
  if (displayName.length < 2) throw invalidInput("The display name must be at least 2 characters long.");

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`)
    .limit(1);
  if (existing) throw conflict("That email address is already in use.");

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
  throw conflict("That display name is too popular, try another.");
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
  const invalid = unauthorized("Incorrect email address or password.");
  if (!row) {
    // On hache quand même, pour que la réponse prenne le même temps.
    await hashPassword(input.password);
    throw invalid;
  }
  if (!(await verifyPassword(input.password, row.passwordHash))) throw invalid;
  if (row.suspendedAt) throw unauthorized("This account is suspended.");

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

/**
 * Change la langue de l'interface.
 *
 * Elle vit sur le compte et non dans le navigateur : c'est un réglage qu'on
 * choisit une fois et qu'on retrouve sur son téléphone comme sur son
 * ordinateur. La contrainte `users_locale_vocab` refuse déjà toute autre
 * valeur en base ; on la vérifie ici pour rendre un message plutôt qu'une
 * erreur de contrainte.
 */
export async function setLocale(
  db: Database,
  userId: string,
  locale: string,
): Promise<PublicUser> {
  if (locale !== "fr" && locale !== "en") throw invalidInput("Unknown language.");

  const [row] = await db
    .update(users)
    .set({ locale })
    .where(eq(users.id, userId))
    .returning();
  if (!row) throw notFound("User not found.");
  return toPublic(row);
}

/**
 * Efface un compte, et tout ce qui s'y rattache.
 *
 * **Le mot de passe est redemandé.** Une session suffit pour tout le reste ;
 * pas pour un geste irréversible. Un téléphone déverrouillé laissé sur une
 * table ne doit pas suffire à effacer huit cents cartes.
 *
 * Ce qui part, et pourquoi c'est énuméré ici plutôt que laissé aux cascades :
 *
 * — la **collection** et les **scanlistes**, par `on delete cascade` ;
 * — les **tentatives d'authentification**, qui ne cascadent pas : elles n'ont
 *   pas de `user_id`, mais leur clé porte l'adresse — `email:ange@exemple.fr`.
 *   C'est de la donnée personnelle, et l'oublier ferait mentir « tout a été
 *   effacé ». Trouvé en listant les clés étrangères vers `users`, qui n'en
 *   montrait que deux.
 *
 * Les impressions du catalogue restent : elles n'appartiennent à personne, et
 * `card_prints.card_passcode` est en `set null` pour cette raison.
 */
export async function deleteAccount(
  db: Database,
  viewerId: string,
  password: string,
): Promise<void> {
  const [row] = await db.select().from(users).where(eq(users.id, viewerId)).limit(1);
  if (!row) throw notFound("User not found.");
  if (!(await verifyPassword(password, row.passwordHash))) {
    throw unauthorized("Incorrect password.");
  }

  await db.transaction(async (tx) => {
    await tx.delete(authAttempts).where(eq(authAttempts.bucket, `email:${row.email.toLowerCase()}`));
    await tx.delete(users).where(eq(users.id, viewerId));
  });
}

export async function getPublicUser(db: Database, userId: string): Promise<PublicUser> {
  const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!row) throw notFound("User not found.");
  return toPublic(row);
}
