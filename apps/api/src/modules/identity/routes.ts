import { Hono } from "hono";
import { z } from "zod";
import type { Database } from "../../db/client.js";
import { invalidInput } from "../../platform/errors.js";
import { clearSessionCookie, setSessionCookie } from "./cookie.js";
import { requireViewer } from "./middleware.js";
import { clearAttempts, enforceRateLimit, recordAttempt } from "./rate-limit.js";
import { LIMITS } from "@atem/shared";
import {
  authenticate, deleteAccount, getPublicUser, registerUser, revokeSessions, setLocale,
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
    if (viewer) await revokeSessions(db, viewer.id);
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
  app.patch("/me/langue", requireViewer, async (c) => {
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

  return app;
}
