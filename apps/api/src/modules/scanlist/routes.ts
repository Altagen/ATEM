/**
 * Les routes des scanlistes.
 *
 * Montées sur `/scanlistes`, à part de `/collection` : ce sont deux
 * inventaires distincts, et les mêler dans le même préfixe aurait fini par les
 * mêler dans le même code.
 */
import { Hono } from "hono";
import { z } from "zod";
import { LIMITS } from "@atem/shared";
import type { Database } from "../../db/client.js";
import { invalidInput } from "../../platform/errors.js";
import { requireViewer } from "../identity/index.js";
import {
  createScanlist, deleteScanlist, getScanlist, listScanlists, pourScanlist,
} from "./service.js";

const LineSchema = z.object({
  setCode: z.string().min(1).max(LIMITS.setCode.max),
  name: z.string().max(200).nullish(),
  passcode: z.number().int().positive().nullish(),
  quantity: z.number().int().min(1).max(LIMITS.quantity.max),
});

const CreateBody = z.object({
  name: z.string().trim().min(LIMITS.scanlistName.min).max(LIMITS.scanlistName.max),
  lines: z.array(LineSchema).min(1).max(LIMITS.scanlist.maxLines),
});

export function scanlistRoutes(db: Database) {
  const app = new Hono();
  app.use("*", requireViewer);

  const viewerId = (c: { get: (key: "viewer") => { id: string } | null }): string => {
    const viewer = c.get("viewer");
    if (!viewer) throw invalidInput("Session absente.");
    return viewer.id;
  };

  const jsonBody = async (c: { req: { json: () => Promise<unknown> } }): Promise<unknown> => {
    try {
      return await c.req.json();
    } catch {
      throw invalidInput("Corps de requête illisible.");
    }
  };

  app.get("/", async (c) => c.json({ items: await listScanlists(db, viewerId(c)) }));

  app.post("/", async (c) => {
    const parsed = CreateBody.safeParse(await jsonBody(c));
    if (!parsed.success) {
      throw invalidInput("Lot invalide.", { issues: parsed.error.issues });
    }
    return c.json(
      await createScanlist(db, viewerId(c), {
        name: parsed.data.name,
        lines: parsed.data.lines.map((line) => ({
          setCode: line.setCode,
          name: line.name ?? null,
          passcode: line.passcode ?? null,
          quantity: line.quantity,
        })),
      }),
      201,
    );
  });

  app.get("/:id", async (c) => c.json(await getScanlist(db, viewerId(c), c.req.param("id"))));

  app.post("/:id/verser", async (c) =>
    c.json(await pourScanlist(db, viewerId(c), c.req.param("id"))),
  );

  app.delete("/:id", async (c) => {
    await deleteScanlist(db, viewerId(c), c.req.param("id"));
    return c.json({ ok: true });
  });

  return app;
}
