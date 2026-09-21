/**
 * The console's routes — the administrator's, and nobody else's: to anyone
 * else they answer “not found”, as if there were nothing here.
 */
import { Hono } from "hono";
import { z } from "zod";
import { LIMITS } from "@atem/shared";
import type { Database } from "../../db/client.js";
import { invalidInput } from "../../platform/errors.js";
import { requireUuid } from "../../platform/identifiers.js";
import { requireAdmin, requireViewer } from "../identity/index.js";
import {
  accounts, actionLog, createAccount, deleteAccount, overview, setRegistration, suspendAccount,
} from "./service.js";

const CreateBody = z.object({
  email: z.string().email().max(254),
  displayName: z.string().min(2).max(32),
  password: z.string().min(1).max(LIMITS.password.max),
});

const SettingsBody = z.object({ registrationOpen: z.boolean() });

async function readBody<T>(c: { req: { json: () => Promise<unknown> } }, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw invalidInput("Unreadable request body.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw invalidInput("Invalid data.", { issues: parsed.error.issues });
  return parsed.data;
}

export function adminRoutes(db: Database) {
  const app = new Hono();
  app.use("*", requireViewer, requireAdmin);

  app.get("/overview", async (c) => c.json(await overview(db)));

  app.get("/accounts", async (c) => c.json({ items: await accounts(db, c.req.query("q")) }));

  app.post("/accounts", async (c) =>
    c.json({ account: await createAccount(db, await readBody(c, CreateBody)) }, 201));

  app.post("/accounts/:id/suspend", async (c) =>
    c.json({ account: await suspendAccount(db, requireUuid(c.req.param("id")), true) }));

  app.post("/accounts/:id/restore", async (c) =>
    c.json({ account: await suspendAccount(db, requireUuid(c.req.param("id")), false) }));

  app.delete("/accounts/:id", async (c) => {
    await deleteAccount(db, requireUuid(c.req.param("id")));
    return c.json({ ok: true });
  });

  app.patch("/settings", async (c) => {
    const body = await readBody(c, SettingsBody);
    return c.json({ registrationOpen: await setRegistration(db, body.registrationOpen) });
  });

  app.get("/log", async (c) => c.json({ items: await actionLog(db) }));

  return app;
}
