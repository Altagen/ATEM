/**
 * The identity module — accounts and sessions.
 *
 * No other module reads the `users` table: they go through `getPublicUser`.
 */
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { cursorAfter, parseCursor } from "../../platform/cursor.js";
import {
  conflict, forbidden, invalidInput, notFound, unauthorized, violatesConstraint,
} from "../../platform/errors.js";
import { checkPasswordStrength, type Avatar, type Visibility } from "@atem/shared";
import { hashPassword, needsRehash, verifyPassword } from "./password.js";
import { authAttempts, instanceSettings, users, type UserRow } from "./schema.js";

export type PublicUser = {
  id: string;
  displayName: string;
  tag: string;
  locale: string;
  role: string;
  /** Shown by the navigation, on the button that opens the account menu. */
  avatar: Avatar;
  createdAt: Date;
  /** The screen sends the account to the password change, and nowhere else. */
  mustChangePassword: boolean;
};

const toPublic = (row: UserRow): PublicUser => ({
  id: row.id,
  displayName: row.displayName,
  tag: row.tag,
  locale: row.locale,
  role: row.role,
  avatar: row.avatar as Avatar,
  createdAt: row.createdAt,
  mustChangePassword: row.mustChangePassword,
});

/** Four digits, `#0042` style. Retried on collision. */
const randomTag = () => String(Math.floor(Math.random() * 10000)).padStart(4, "0");

/**
 * May anyone create an account here? The instance's one setting (Ange,
 * 2026-09-21): open, or only the administrator creates accounts.
 */
export async function registrationOpen(db: Database): Promise<boolean> {
  const [row] = await db.select().from(instanceSettings).where(eq(instanceSettings.id, 1)).limit(1);
  // The migration writes the row; its absence is a broken database, and the
  // safe reading of a broken database is “closed”.
  return row?.registrationOpen ?? false;
}

export async function setRegistrationOpen(db: Database, open: boolean): Promise<boolean> {
  const [row] = await db
    .insert(instanceSettings)
    .values({ id: 1, registrationOpen: open })
    .onConflictDoUpdate({ target: instanceSettings.id, set: { registrationOpen: open, updatedAt: new Date() } })
    .returning();
  return row?.registrationOpen ?? open;
}

/** Signing up, by the person themselves — when the instance allows it. */
export async function registerUser(
  db: Database,
  input: { email: string; password: string; displayName: string },
): Promise<{ user: PublicUser; tokenVersion: number }> {
  if (!(await registrationOpen(db))) {
    throw forbidden("Registration is closed on this instance: ask its administrator for an account.");
  }
  const row = await insertAccount(db, input, { present: true, mustChangePassword: false });
  return { user: toPublic(row), tokenVersion: row.tokenVersion };
}

/**
 * An account opened by the administrator, open registration or not.
 *
 * Its password is the administrator's choice, so they know it: the account
 * must pick its own at its first sign-in, before anything else.
 */
export async function createAccountAsAdmin(
  db: Database,
  input: { email: string; password: string; displayName: string },
): Promise<AdminAccount> {
  return toAdminAccount(await insertAccount(db, input, { present: false, mustChangePassword: true }));
}

/**
 * The account itself, however it is opened. The checks are the same for both
 * ways in: the password rule, the address, the name.
 */
async function insertAccount(
  db: Database,
  input: { email: string; password: string; displayName: string },
  options: { present: boolean; mustChangePassword: boolean; role?: "member" | "admin" },
): Promise<UserRow> {
  /**
   * The rule comes from `@atem/shared`, the same function the screen uses to
   * draw its meter. The earlier prototype had four diverging copies, and one of them
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
        .values({
          email, passwordHash, displayName, tag: randomTag(),
          role: options.role ?? "member",
          mustChangePassword: options.mustChangePassword,
          // Present from the first second: signing up is being there. An
          // account someone else opened is not, until its owner signs in.
          lastSeenAt: options.present ? new Date() : null,
        })
        .returning();
      if (!row) throw new Error("insert returned nothing");
      return row;
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
  if (row.suspendedAt) throw unauthorized("This account is suspended: contact the administrator of this instance.");

  const values: Partial<UserRow> = { lastSeenAt: new Date() };
  if (needsRehash(row.passwordHash)) {
    // The cleartext password is only available here.
    values.passwordHash = await hashPassword(input.password);
  }
  // Signing in is presence too: without this, someone who has just arrived
  // appears away until their next request.
  await db.update(users).set(values).where(eq(users.id, row.id));

  return { user: toPublic(row), tokenVersion: row.tokenVersion };
}

/**
 * Signing out: every token issued for this account stops working, and the
 * account stops being shown as online.
 *
 * Presence used to outlive the session: whoever signed out stayed “online”
 * for the whole window, which told the others something false (Ange,
 * 2026-09-21). Nothing else reads `lastSeenAt`, so clearing it loses nothing.
 */
export async function signOut(db: Database, userId: string): Promise<void> {
  await db
    .update(users)
    .set({ tokenVersion: sql`${users.tokenVersion} + 1`, lastSeenAt: null })
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
/**
 * What other modules must do before an account goes, that the foreign keys
 * cannot say — a condition, not a cascade. Registered where the application is
 * put together (`app.ts`), so identity depends on nobody: today the duels
 * forget their unfinished games (`forgetPlayerDuels`).
 */
type DeletionListener = (db: Database, userId: string) => Promise<void>;
const deletionListeners = new Set<DeletionListener>();

export function onAccountDeletion(listener: DeletionListener): void {
  deletionListeners.add(listener);
}

/** The erasure itself, whoever asked for it: listeners, attempts, then the row. */
async function eraseAccount(db: Database, row: UserRow): Promise<void> {
  await db.transaction(async (tx) => {
    for (const listener of deletionListeners) await listener(tx as unknown as Database, row.id);
    await tx.delete(authAttempts).where(eq(authAttempts.bucket, `email:${row.email.toLowerCase()}`));
    await tx.delete(users).where(eq(users.id, row.id));
  });
}

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

  await eraseAccount(db, row);
}

export async function getPublicUser(db: Database, userId: string): Promise<PublicUser> {
  const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!row) throw notFound("User not found.");
  return toPublic(row);
}

/**
 * What a profile shows — to its owner and to any other signed-in duellist.
 *
 * No email and no locale: those are the account's, not the profile's.
 */
export type Profile = {
  id: string;
  displayName: string;
  tag: string;
  avatar: Avatar;
  bio: string;
  createdAt: Date;
};

/**
 * A profile by its owner's identifier.
 *
 * A suspended account has no profile to show: “not found”, like an account that
 * does not exist, so the answer does not tell the two apart.
 */
export async function getProfile(db: Database, ownerId: string): Promise<Profile> {
  const [row] = await db.select().from(users).where(eq(users.id, ownerId)).limit(1);
  // The administrator is not a player: no profile, like an account that is not there.
  if (!row || row.suspendedAt || row.role === "admin") throw notFound("Player not found.");
  return {
    id: row.id,
    displayName: row.displayName,
    tag: row.tag,
    avatar: row.avatar as Avatar,
    bio: row.bio,
    createdAt: row.createdAt,
  };
}

/**
 * A profile, plus whether the account is around.
 *
 * Presence is the identity module's to answer: it owns `lastSeenAt`, stamped by
 * the session guard. Five minutes is the window: an open tab asks for the inbox
 * every few seconds, so someone reading a deck stays well inside it, and a tab
 * closed or left in the background drops out soon enough to mean something.
 * Fifteen minutes showed people online long after they had gone (Ange,
 * 2026-09-21).
 */
export type Duellist = Profile & { isOnline: boolean };

const PRESENCE_WINDOW_MINUTES = 5;

const toDuellist = (row: UserRow, since: number): Duellist => ({
  id: row.id,
  displayName: row.displayName,
  tag: row.tag,
  avatar: row.avatar as Avatar,
  bio: row.bio,
  createdAt: row.createdAt,
  isOnline: row.lastSeenAt !== null && row.lastSeenAt.getTime() >= since,
});

/**
 * The accounts another duellist may be shown — suspended ones excluded.
 *
 * `search` matches the display name **or the number**: `Yugi#0042` is how people
 * give themselves out, and the earlier prototype searched the name alone. Who is filtered out
 * for a relation — blocked either way — is the social module's business, not
 * this one's: it receives the list and removes them.
 */
export async function listProfiles(
  db: Database,
  options: { search?: string; excludeId?: string; ids?: string[]; limit?: number } = {},
): Promise<Duellist[]> {
  const search = options.search?.trim().toLowerCase().replace(/^#/, "") ?? "";
  if (options.ids && options.ids.length === 0) return [];

  const rows = await db
    .select()
    .from(users)
    .where(and(
      sql`${users.suspendedAt} is null`,
      // Nor in the directory: the administrator's account only administers.
      sql`${users.role} <> 'admin'`,
      options.excludeId ? sql`${users.id} <> ${options.excludeId}` : sql`true`,
      options.ids ? inArray(users.id, options.ids) : sql`true`,
      search
        ? sql`(lower(${users.displayName}) like ${`%${search}%`} or ${users.tag} like ${`%${search}%`})`
        : sql`true`,
    ))
    .orderBy(users.displayName)
    .limit(options.limit ?? 500);

  const since = Date.now() - PRESENCE_WINDOW_MINUTES * 60_000;
  return rows.map((row) => toDuellist(row, since));
}

/**
 * The identifier of an account someone may act on, or nothing.
 *
 * Suspended accounts answer like absent ones: a relation cannot be built with
 * an account that is not there. The administrator's neither: it is nobody's
 * friend, and nobody's opponent (Ange, 2026-09-21).
 */
export async function activePlayerId(db: Database, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), sql`${users.suspendedAt} is null`, sql`${users.role} <> 'admin'`))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Renaming keeps your number when it can.
 *
 * `(display name, tag)` is unique, not the name alone: two people may both be
 * called Yugi. So a rename only needs a new number if the one you carry is
 * already taken under the new name — `Yugi#0042` becoming `YugiMaster` stays
 * `#0042`, which is what people give out and write on a deck box.
 *
 * Taken from the earlier prototype's `tagForRename`, whose reasoning was right.
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
 * What the profile shows: the name you are known by, bio and avatar.
 *
 * All optional and independent — a request that carries one changes one. The
 * profile's edit window sends them together, so they land in one write: The earlier prototype
 * sent two requests, and a failed second one left the profile half saved behind a
 * success message.
 * Nothing here touches the password, which has its own route and its own
 * refusals.
 */
export async function updateAccount(
  db: Database,
  userId: string,
  input: { displayName?: string; bio?: string; avatar?: Avatar },
): Promise<PublicUser> {
  const values: Partial<{ displayName: string; tag: string; bio: string; avatar: Avatar }> = {};

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

  if (input.bio !== undefined) values.bio = input.bio.trim();
  if (input.avatar !== undefined) values.avatar = input.avatar;

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
      // The password is now the owner's own: the account is theirs to use.
      mustChangePassword: false,
    })
    .where(eq(users.id, userId))
    .returning();
  if (!updated) throw notFound("Account not found.");

  return { user: toPublic(updated), tokenVersion: updated.tokenVersion };
}

/**
 * The first password an account chooses, after the administrator set one.
 *
 * No current password is asked: the session was opened with it minutes ago,
 * and asking again proves nothing more (Ange, 2026-09-22). That is also why it
 * is **only** open to an account that must change its password — for anyone
 * else, a session alone must never be enough to change it.
 */
export async function chooseFirstPassword(
  db: Database,
  userId: string,
  newPassword: string,
): Promise<{ user: PublicUser; tokenVersion: number }> {
  const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!row) throw notFound("Account not found.");
  if (!row.mustChangePassword) throw forbidden("Your password is already your own: change it from the settings.");

  const strength = checkPasswordStrength(newPassword);
  if (!strength.isValid) {
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
      passwordHash: await hashPassword(newPassword),
      tokenVersion: sql`${users.tokenVersion} + 1`,
      mustChangePassword: false,
      // Choosing it is the account's real first arrival.
      lastSeenAt: new Date(),
    })
    .where(eq(users.id, userId))
    .returning();
  if (!updated) throw notFound("Account not found.");
  return { user: toPublic(updated), tokenVersion: updated.tokenVersion };
}

/**
 * Changing the address you sign in with — behind your password.
 *
 * The address is what a password reset would go to the day there is one, and
 * what signing in asks for: whoever changes it takes the account. So a session
 * alone is not enough — an unlocked screen would do. The earlier prototype's window asked for
 * the password and its server never read it; this one checks it, **before**
 * looking at the address, so a stolen session cannot use this route to find out
 * which addresses have an account.
 *
 * Other sessions are kept: the password has not changed, and a session is not
 * tied to the address.
 */
export async function changeEmail(
  db: Database,
  userId: string,
  input: { email: string; password: string },
): Promise<PublicUser> {
  const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!row) throw notFound("Account not found.");
  if (!(await verifyPassword(input.password, row.passwordHash))) {
    throw unauthorized("The current password is incorrect.");
  }

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

  try {
    const [updated] = await db.update(users).set({ email }).where(eq(users.id, userId)).returning();
    if (!updated) throw notFound("Account not found.");
    return toPublic(updated);
  } catch (err) {
    // Taken between the check and the write: the same refusal, for the same reason.
    if (violatesConstraint(err, "users_email_uidx")) {
      throw conflict("This email address cannot be used for this account.");
    }
    throw err;
  }
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
export type AccountDetails = PublicUser & { email: string; visibility: Visibilities };

export async function getAccount(db: Database, userId: string): Promise<AccountDetails> {
  const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!row) throw notFound("Account not found.");
  return { ...toPublic(row), email: row.email, visibility: visibilitiesOf(row) };
}

/** Who may look at the collection, and at the decks. */
export type Visibilities = { collection: Visibility; decks: Visibility };

const visibilitiesOf = (row: UserRow): Visibilities => ({
  collection: row.collectionVisibility as Visibility,
  decks: row.deckVisibility as Visibility,
});

/**
 * What a duellist chose to show — for `social`'s checkpoint, which decides.
 *
 * `null` for an account that does not exist: the checkpoint answers that the
 * same way as a refusal, and never has to guess a default.
 */
export async function visibilityOf(db: Database, userId: string): Promise<Visibilities | null> {
  const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return row ? visibilitiesOf(row) : null;
}

/** Changes who may look — either, or both. */
export async function setVisibility(
  db: Database,
  userId: string,
  input: Partial<Visibilities>,
): Promise<Visibilities> {
  const values: Partial<{ collectionVisibility: Visibility; deckVisibility: Visibility }> = {};
  if (input.collection !== undefined) values.collectionVisibility = input.collection;
  if (input.decks !== undefined) values.deckVisibility = input.decks;
  if (Object.keys(values).length === 0) throw invalidInput("Nothing to change.");
  const [row] = await db.update(users).set(values).where(eq(users.id, userId)).returning();
  if (!row) throw notFound("Account not found.");
  return visibilitiesOf(row);
}

// ── Administration ──────────────────────────────────────────────────────────
//
// What the admin module asks of identity (R1: it never touches `users`). Every
// function here leaves the administrator's own account out: it is not one of
// the accounts it administers.

/** An account as the console lists it — the address included, for its admin. */
export type AdminAccount = {
  id: string;
  displayName: string;
  tag: string;
  email: string;
  createdAt: Date;
  lastSeenAt: Date | null;
  suspendedAt: Date | null;
  mustChangePassword: boolean;
};

const toAdminAccount = (row: UserRow): AdminAccount => ({
  id: row.id,
  displayName: row.displayName,
  tag: row.tag,
  email: row.email,
  createdAt: row.createdAt,
  lastSeenAt: row.lastSeenAt,
  suspendedAt: row.suspendedAt,
  mustChangePassword: row.mustChangePassword,
});

/** How many accounts the console shows at once; the rest comes on demand. */
const ACCOUNTS_PAGE = 50;

/**
 * The console's list: newest first, searched by name, number or address —
 * **a page at a time**. It used to stop at two hundred without saying so: the
 * two hundred and first account existed and could not be found.
 */
export async function listAccounts(
  db: Database,
  options: { search?: string; cursor?: string } = {},
): Promise<{ items: AdminAccount[]; nextCursor: string | null }> {
  const search = options.search?.trim().toLowerCase().replace(/^#/, "") ?? "";
  const after = parseCursor(options.cursor);
  const rows = await db
    .select()
    .from(users)
    .where(and(
      ne(users.role, "admin"),
      search
        ? sql`(lower(${users.displayName}) like ${`%${search}%`} or ${users.tag} like ${`%${search}%`}
              or lower(${users.email}) like ${`%${search}%`})`
        : sql`true`,
      after ? sql`(${users.createdAt}, ${users.id}) < (${after.at}::timestamptz, ${after.id}::uuid)` : sql`true`,
    ))
    .orderBy(desc(users.createdAt), desc(users.id))
    .limit(ACCOUNTS_PAGE + 1);
  const page = rows.slice(0, ACCOUNTS_PAGE);
  const last = page.at(-1);
  return {
    items: page.map(toAdminAccount),
    nextCursor: rows.length > ACCOUNTS_PAGE && last ? cursorAfter(last.createdAt, last.id) : null,
  };
}

/** The dashboard's figures — counted, never estimated. */
export async function accountCounts(db: Database): Promise<{ players: number; online: number; suspended: number }> {
  const since = new Date(Date.now() - PRESENCE_WINDOW_MINUTES * 60_000);
  const [row] = await db
    .select({
      players: sql<number>`count(*)::int`,
      online: sql<number>`count(*) filter (where ${users.lastSeenAt} >= ${since.toISOString()}::timestamptz
                                            and ${users.suspendedAt} is null)::int`,
      suspended: sql<number>`count(*) filter (where ${users.suspendedAt} is not null)::int`,
    })
    .from(users)
    .where(ne(users.role, "admin"));
  return { players: row?.players ?? 0, online: row?.online ?? 0, suspended: row?.suspended ?? 0 };
}

/** An account the console may act on — never the administrator's own. */
async function administeredRow(db: Database, id: string): Promise<UserRow> {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!row || row.role === "admin") throw notFound("Account not found.");
  return row;
}

/**
 * Suspends or restores an account.
 *
 * Suspending ends every session at once (the version moves on, so no token
 * issued before it works again, even after a restore) and takes the account
 * out of the presence: a suspended account is not “online”.
 */
export async function setSuspended(db: Database, id: string, suspended: boolean): Promise<AdminAccount> {
  await administeredRow(db, id);
  const [row] = await db
    .update(users)
    .set(suspended
      ? { suspendedAt: new Date(), tokenVersion: sql`${users.tokenVersion} + 1`, lastSeenAt: null }
      : { suspendedAt: null })
    .where(eq(users.id, id))
    .returning();
  if (!row) throw notFound("Account not found.");
  return toAdminAccount(row);
}

/**
 * Deletes an account from the console — the same erasure as the owner's own
 * deletion, without the password, which only its owner has.
 */
export async function deleteAccountAsAdmin(db: Database, id: string): Promise<AdminAccount> {
  const row = await administeredRow(db, id);
  await eraseAccount(db, row);
  return toAdminAccount(row);
}

/**
 * Makes the configuration's administrator true in the database — at every
 * start.
 *
 * Asked for by Ange on 2026-09-21: **one** administrator, whose credentials are
 * written in the configuration, as code. So the configuration wins: a changed
 * password there is the password here at the next start, and any other account
 * found holding the role loses it.
 *
 * An address already carried by a **player** is refused rather than promoted:
 * turning someone's account into the console's would hand the console to
 * whoever holds that player's password, and take the player's collection out
 * of every screen.
 */
export async function ensureAdministrator(
  db: Database,
  input: { email: string; password: string; displayName: string },
): Promise<{ created: boolean }> {
  const strength = checkPasswordStrength(input.password);
  if (!strength.isValid) {
    throw invalidInput("The administrator's password must be at least 16 characters long and contain an uppercase letter, a lowercase letter, a digit and a special character.");
  }
  const email = input.email.trim();
  const [existing] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`)
    .limit(1);

  let adminId: string;
  let created = false;
  if (existing && existing.role !== "admin") {
    throw conflict(`The administrator's address ${email} already belongs to a player's account.`);
  }
  if (existing) {
    adminId = existing.id;
    const values: Partial<UserRow> = { suspendedAt: null, mustChangePassword: false };
    if (!(await verifyPassword(input.password, existing.passwordHash))) {
      values.passwordHash = await hashPassword(input.password);
      // A new password in the configuration ends the sessions of the old one.
      values.tokenVersion = existing.tokenVersion + 1;
    }
    if (existing.displayName !== input.displayName.trim()) values.displayName = input.displayName.trim();
    await db.update(users).set(values).where(eq(users.id, existing.id));
  } else {
    const row = await insertAccount(db, { ...input, email }, {
      present: false, mustChangePassword: false, role: "admin",
    });
    adminId = row.id;
    created = true;
  }

  // One administrator: whoever else holds the role — an earlier address in the
  // configuration — goes back to being a member.
  await db.update(users).set({ role: "member" }).where(and(eq(users.role, "admin"), ne(users.id, adminId)));
  return { created };
}
