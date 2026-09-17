/**
 * The identity module — accounts and sessions.
 *
 * No other module reads the `users` table: they go through `getPublicUser`.
 */
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import {
  conflict, invalidInput, notFound, unauthorized, violatesConstraint,
} from "../../platform/errors.js";
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

/** Four digits, `#0042` style. Retried on collision. */
const randomTag = () => String(Math.floor(Math.random() * 10000)).padStart(4, "0");

export async function registerUser(
  db: Database,
  input: { email: string; password: string; displayName: string },
): Promise<{ user: PublicUser; tokenVersion: number }> {
  /**
   * The rule comes from `@atem/shared`, the same function the screen uses to
   * draw its meter. ATEM-old had four diverging copies, and one of them
   * approved passwords the server then refused.
   */
  const strength = checkPasswordStrength(input.password);
  if (!strength.isValid) {
    throw invalidInput(
      // A single string, not two concatenated: this is what the front looks up
      // in the dictionary to render it in French.
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
  if (existing) {
    /**
     * The refusal does not say **why**, the log does.
     *
     * “That address is already in use” hands an attacker a membership test for
     * any address they care to try. Asked for by Ange: the screen stays vague,
     * the operator keeps the real reason.
     *
     * Be clear about what this does and does not buy. It removes the plain
     * statement; it does not close enumeration, because registering still
     * succeeds for a free address and fails for a taken one, and that
     * difference is the answer. Closing it for good needs an email we do not
     * send — accept every registration, then tell the address's owner that
     * someone tried. Until then the register ceiling is what bounds the sweep.
     *
     * The address is logged in full: on a self-hosted instance the operator
     * already holds every address in the database, so this exposes nothing new
     * and is what makes “why can this person not sign up?” answerable.
     */
    console.warn(`[atem] register refused: ${email} already has an account`);
    throw conflict("An account cannot be created with this email address.");
  }

  const passwordHash = await hashPassword(input.password);

  // The (display name, tag) pair is unique: we retry on collision rather than
  // refusing a display name someone else already carries.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const [row] = await db
        .insert(users)
        .values({ email, passwordHash, displayName, tag: randomTag() })
        .returning();
      if (!row) throw new Error("insert returned nothing");
      return { user: toPublic(row), tokenVersion: row.tokenVersion };
    } catch (err) {
      // Not `err.message`: Drizzle wraps the driver's error and the name is in
      // the cause. Reading the message made this retry dead code — see
      // `violatesConstraint`.
      if (!violatesConstraint(err, "users_name_tag_uidx")) throw err;
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

  // The same message in both cases: distinguishing “unknown account” from
  // “wrong password” would reveal which addresses have an account here.
  const invalid = unauthorized("Incorrect email address or password.");
  if (!row) {
    // We hash anyway, so that the answer takes the same time.
    await hashPassword(input.password);
    throw invalid;
  }
  if (!(await verifyPassword(input.password, row.passwordHash))) throw invalid;
  if (row.suspendedAt) throw unauthorized("This account is suspended.");

  // The cleartext password is only available here: it is the only moment when
  // a hash produced under an outdated cost can be recomputed.
  if (needsRehash(row.passwordHash)) {
    const fresh = await hashPassword(input.password);
    await db.update(users).set({ passwordHash: fresh }).where(eq(users.id, row.id));
  }

  return { user: toPublic(row), tokenVersion: row.tokenVersion };
}

/** Invalidates every token issued for this account. */
export async function revokeSessions(db: Database, userId: string): Promise<void> {
  await db
    .update(users)
    .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
    .where(eq(users.id, userId));
}

/**
 * Changes the interface language.
 *
 * It lives on the account rather than in the browser: it is a setting you
 * choose once and find again on your phone as on your computer. The
 * `users_locale_vocab` constraint already refuses any other value in the
 * database; we check it here to return a message rather than a constraint
 * error.
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
 * Deletes an account, and everything attached to it.
 *
 * **The password is asked again.** A session is enough for everything else; not
 * for an irreversible gesture. An unlocked phone left on a table must not be
 * enough to erase eight hundred cards.
 *
 * What goes, and why it is listed here rather than left to cascades:
 *
 * — the **collection** and the **scanlists**, through `on delete cascade`;
 * — the **authentication attempts**, which do not cascade: they have no
 *   `user_id`, but their key carries the address — `email:ange@example.com`.
 *   That is personal data, and forgetting it would make “everything has been
 *   erased” a lie. Found by listing the foreign keys pointing at `users`, which
 *   showed only two.
 *
 * The catalogue's printings stay: they belong to nobody, and
 * `card_prints.card_passcode` is `set null` for that reason.
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

/**
 * Renaming keeps your number when it can.
 *
 * `(display name, tag)` is unique, not the name alone: two people may both be
 * called Yugi. So a rename only needs a new number if the one you carry is
 * already taken under the new name — `Yugi#0042` becoming `YugiMaster` stays
 * `#0042`, which is what people give out and write on a deck box.
 *
 * Taken from ATEM-old's `tagForRename`, whose reasoning was right.
 */
async function tagForRename(
  db: Database,
  userId: string,
  currentTag: string,
  newDisplayName: string,
): Promise<string> {
  const [clash] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.displayName, newDisplayName), eq(users.tag, currentTag)))
    .limit(1);

  return clash && clash.id !== userId ? randomTag() : currentTag;
}

/**
 * The account's own details: the name you are known by, and the address you
 * sign in with.
 *
 * Both are optional and independent — a request that carries one changes one.
 * Nothing here touches the password, which has its own route and its own
 * refusals.
 */
export async function updateAccount(
  db: Database,
  userId: string,
  input: { displayName?: string; email?: string },
): Promise<PublicUser> {
  const values: Partial<{ displayName: string; tag: string; email: string }> = {};

  if (input.displayName !== undefined) {
    const displayName = input.displayName.trim();
    if (displayName.length < 2) {
      throw invalidInput("The display name must be at least 2 characters long.");
    }
    const [self] = await db
      .select({ tag: users.tag })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!self) throw notFound("Account not found.");
    values.displayName = displayName;
    values.tag = await tagForRename(db, userId, self.tag, displayName);
  }

  if (input.email !== undefined) {
    const email = input.email.trim().toLowerCase();
    if (!email.includes("@")) throw invalidInput("Invalid email address.");
    const [taken] = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = lower(${email})`)
      .limit(1);
    if (taken && taken.id !== userId) {
      // Same rule as registration (ADR-011): the refusal does not say why, the
      // log does. Telling the person their new address “is already in use”
      // answers, for anyone who asks, whether it has an account here.
      console.warn(`[atem] email change refused: ${email} already has an account`);
      throw conflict("This email address cannot be used for this account.");
    }
    values.email = email;
  }

  if (Object.keys(values).length === 0) throw invalidInput("Nothing to change.");

  // The retry is the same as registration's, and for the same reason: a rename
  // can land on a taken number between the check above and this write.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const [row] = await db.update(users).set(values).where(eq(users.id, userId)).returning();
      if (!row) throw notFound("Account not found.");
      return toPublic(row);
    } catch (err) {
      if (!violatesConstraint(err, "users_name_tag_uidx")) throw err;
      values.tag = randomTag();
    }
  }
  throw conflict("That display name is too popular, try another.");
}

/**
 * Changing the password signs out everywhere **else**.
 *
 * That is the whole point of the gesture: you change it because a password may
 * have leaked, so every session issued with the old one has to stop. The caller
 * is handed a fresh token for the session it is holding — otherwise the person
 * changing their password would be the first one signed out, on the very screen
 * where they did it.
 *
 * The old password is required and verified. Without that, anyone finding an
 * unlocked screen could lock its owner out of their own account.
 */
export async function changePassword(
  db: Database,
  userId: string,
  input: { currentPassword: string; newPassword: string },
): Promise<{ user: PublicUser; tokenVersion: number }> {
  const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!row) throw notFound("Account not found.");

  if (!(await verifyPassword(input.currentPassword, row.passwordHash))) {
    throw unauthorized("The current password is incorrect.");
  }

  const strength = checkPasswordStrength(input.newPassword);
  if (!strength.isValid) {
    // The details say **which** rule is unmet, so the screen can point at it —
    // the same shape the registration form already reads.
    throw invalidInput("The password does not meet the required criteria.", {
      hasMinLength: strength.hasMinLength,
      hasUpper: strength.hasUpper,
      hasLower: strength.hasLower,
      hasDigit: strength.hasDigit,
      hasSpecial: strength.hasSpecial,
    });
  }

  const [updated] = await db
    .update(users)
    .set({
      passwordHash: await hashPassword(input.newPassword),
      tokenVersion: sql`${users.tokenVersion} + 1`,
    })
    .where(eq(users.id, userId))
    .returning();
  if (!updated) throw notFound("Account not found.");

  return { user: toPublic(updated), tokenVersion: updated.tokenVersion };
}

/**
 * The account's private details — only ever about yourself.
 *
 * Kept apart from `PublicUser` on purpose. `PublicUser` is the shape other people
 * will see once the duellist list exists; putting the email in it would publish
 * every address on the instance the day that screen ships, with nothing in the
 * diff that led there to say so. What only its owner may read has its own type,
 * and its own route.
 */
export type AccountDetails = PublicUser & { email: string };

export async function getAccount(db: Database, userId: string): Promise<AccountDetails> {
  const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!row) throw notFound("Account not found.");
  return { ...toPublic(row), email: row.email };
}
