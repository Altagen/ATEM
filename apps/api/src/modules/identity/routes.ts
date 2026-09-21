import { Hono } from "hono";
import { z } from "zod";
import type { Database } from "../../db/client.js";
import { invalidInput } from "../../platform/errors.js";
import { clearSessionCookie, setSessionCookie } from "./cookie.js";
import { requireViewer } from "./middleware.js";
import { clearAttempts, enforceRateLimit, recordAttempt } from "./rate-limit.js";
import { AVATARS, LIMITS, VISIBILITIES } from "@atem/shared";
import {
  authenticate, changePassword, deleteAccount, getPublicUser, registerUser, signOut,
  changeEmail, getAccount, setLocale, setVisibility, updateAccount,
} from "./service.js";
import { issueToken } from "./token.js";

const RegisterBody = z.object({
  email: z.string().email().max(254),
  // The strength rule is applied by the service, with the detail of what is
  // missing: here we only bound the size, to refuse the absurd early.
  password: z.string().min(1).max(LIMITS.password.max),
  displayName: z.string().min(2).max(32),
});

const LoginBody = z.object({
  email: z.string().max(254),
  password: z.string().max(512),
});

const AccountBody = z
  .object({
    displayName: z.string().min(2).max(32).optional(),
    // Measured before trimming, as the screen's counter measures it.
    bio: z.string().max(LIMITS.bio.max).optional(),
    avatar: z.enum(AVATARS).optional(),
  })
  // An empty body is a request for nothing, which is a mistake, not a no-op.
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: "Nothing to change.",
  });

const VisibilityBody = z
  .object({ collection: z.enum(VISIBILITIES).optional(), decks: z.enum(VISIBILITIES).optional() })
  .refine((body) => body.collection !== undefined || body.decks !== undefined, {
    message: "Nothing to change.",
  });

const EmailBody = z.object({
  email: z.string().email().max(LIMITS.email.max),
  password: z.string().min(1).max(LIMITS.password.max),
});

const PasswordBody = z.object({
  currentPassword: z.string().min(1).max(LIMITS.password.max),
  // The strength rule lives in the service, which returns what is missing.
  newPassword: z.string().min(1).max(LIMITS.password.max),
});

async function readBody<T>(c: { req: { json: () => Promise<unknown> } }, schema: z.ZodType<T>) {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw invalidInput("Unreadable request body.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw invalidInput("Invalid data.", { issues: parsed.error.issues });
  }
  return parsed.data;
}

export function identityRoutes(db: Database) {
  const app = new Hono();

  app.post("/register", async (c) => {
    const body = await readBody(c, RegisterBody);
    const buckets = [`ip:${c.get("callerIp")}`, `email:${body.email.toLowerCase()}`];
    await enforceRateLimit(db, "register", buckets);
    await recordAttempt(db, "register", buckets);

    const { user, tokenVersion } = await registerUser(db, body);
    setSessionCookie(c, issueToken(user.id, tokenVersion));
    return c.json({ user }, 201);
  });

  app.post("/login", async (c) => {
    const body = await readBody(c, LoginBody);
    const buckets = [`ip:${c.get("callerIp")}`, `email:${body.email.toLowerCase()}`];
    await enforceRateLimit(db, "login", buckets);
    await recordAttempt(db, "login", buckets);

    const { user, tokenVersion } = await authenticate(db, body);
    // Success releases the counters: otherwise ten legitimate sign-ins in
    // fifteen minutes would lock out a normal user.
    await clearAttempts(db, "login", buckets);
    setSessionCookie(c, issueToken(user.id, tokenVersion));
    return c.json({ user });
  });

  app.post("/logout", requireViewer, async (c) => {
    const viewer = c.get("viewer");
    if (viewer) await signOut(db, viewer.id);
    clearSessionCookie(c);
    return c.json({ ok: true });
  });

  app.get("/me", requireViewer, async (c) => {
    const viewer = c.get("viewer");
    if (!viewer) throw invalidInput("No session.");
    return c.json({ user: await getPublicUser(db, viewer.id) });
  });

  /**
   * Deleting your account.
   *
   * `DELETE` and not `POST`: the verb says what happens. The password is in the
   * body because it is asked again — a session is enough for everything else,
   * not for an irreversible gesture.
   */
  app.delete("/me", requireViewer, async (c) => {
    const viewer = c.get("viewer");
    if (!viewer) throw invalidInput("No session.");

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw invalidInput("Unreadable request body.");
    }
    const parsed = z.object({ password: z.string().min(1).max(LIMITS.password.max) }).safeParse(raw);
    if (!parsed.success) throw invalidInput("Password required.");

    await deleteAccount(db, viewer.id, parsed.data.password);
    clearSessionCookie(c);
    return c.json({ ok: true });
  });

  /** The interface language, carried by the account. */
  app.patch("/me/locale", requireViewer, async (c) => {
    const viewer = c.get("viewer");
    if (!viewer) throw invalidInput("No session.");

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw invalidInput("Unreadable request body.");
    }
    const parsed = z.object({ locale: z.enum(["fr", "en"]) }).safeParse(raw);
    if (!parsed.success) throw invalidInput("Unknown language.");

    return c.json({ user: await setLocale(db, viewer.id, parsed.data.locale) });
  });

  /** Your own details, email included — never someone else's. */
  app.get("/me/account", requireViewer, async (c) => {
    const viewer = c.get("viewer");
    if (!viewer) throw invalidInput("No session.");
    return c.json({ account: await getAccount(db, viewer.id) });
  });

  /** What the profile shows: the name you are known by, bio and avatar. */
  app.patch("/me", requireViewer, async (c) => {
    const viewer = c.get("viewer");
    if (!viewer) throw invalidInput("No session.");
    const body = await readBody(c, AccountBody);
    return c.json({ user: await updateAccount(db, viewer.id, body) });
  });

  /** Who may look at the collection, and at the decks. */
  app.patch("/me/visibility", requireViewer, async (c) => {
    const viewer = c.get("viewer");
    if (!viewer) throw invalidInput("No session.");
    const body = await readBody(c, VisibilityBody);
    return c.json({ visibility: await setVisibility(db, viewer.id, body) });
  });

  /**
   * Changing the email address — behind the password, and rate-limited like
   * signing in for the same reason as the password change: it verifies the
   * password, so without a ceiling it is a guessing oracle for a stolen session.
   */
  app.post("/me/email", requireViewer, async (c) => {
    const viewer = c.get("viewer");
    if (!viewer) throw invalidInput("No session.");
    const body = await readBody(c, EmailBody);

    const buckets = [`ip:${c.get("callerIp")}`, `account:${viewer.id}`];
    await enforceRateLimit(db, "login", buckets);
    await recordAttempt(db, "login", buckets);

    const user = await changeEmail(db, viewer.id, body);
    await clearAttempts(db, "login", buckets);
    return c.json({ user });
  });

  /**
   * Changing the password — rate-limited like signing in.
   *
   * It verifies the current password, so it is a guessing oracle for anyone
   * holding a stolen session: without a ceiling, a cookie lifted from an
   * unlocked browser becomes an unlimited attempt at the real password. The
   * buckets are the same two as signing in — the caller's address and the
   * account — so a failure here and a failure at the door count together.
   */
  app.post("/me/password", requireViewer, async (c) => {
    const viewer = c.get("viewer");
    if (!viewer) throw invalidInput("No session.");
    const body = await readBody(c, PasswordBody);

    const buckets = [`ip:${c.get("callerIp")}`, `account:${viewer.id}`];
    await enforceRateLimit(db, "login", buckets);
    await recordAttempt(db, "login", buckets);

    const { user, tokenVersion } = await changePassword(db, viewer.id, body);
    await clearAttempts(db, "login", buckets);
    // Every other session was just revoked; this one is handed a fresh token,
    // or the person would be signed out on the screen where they did it.
    setSessionCookie(c, issueToken(user.id, tokenVersion));
    return c.json({ user });
  });

  return app;
}
