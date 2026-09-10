import { Hono } from "hono";
import { z } from "zod";
import type { Database } from "../../db/client.js";
import { invalidInput } from "../../platform/errors.js";
import { clearSessionCookie, setSessionCookie } from "./cookie.js";
import { requireViewer } from "./middleware.js";
import { clearAttempts, enforceRateLimit, recordAttempt } from "./rate-limit.js";
import { LIMITS } from "@atem/shared";
import {
  authenticate, getPublicUser, registerUser, revokeSessions,
} from "./service.js";
import { issueToken } from "./token.js";

const RegisterBody = z.object({
  email: z.string().email().max(254),
  // La règle de force est appliquée par le service, avec le détail de ce qui
  // manque : ici on ne borne que la taille, pour refuser tôt l'absurde.
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
    throw invalidInput("Corps de requête illisible.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw invalidInput("Données invalides.", { issues: parsed.error.issues });
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
    // La réussite libère les compteurs : sinon dix connexions légitimes en
    // quinze minutes verrouilleraient un utilisateur normal.
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
    if (!viewer) throw invalidInput("Session absente.");
    return c.json({ user: await getPublicUser(db, viewer.id) });
  });

  return app;
}
