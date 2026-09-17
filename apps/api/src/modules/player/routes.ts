/**
 * The player routes — read-only by construction (`readOnlyRoutes`).
 */
import type { Database } from "../../db/client.js";
import { invalidInput } from "../../platform/errors.js";
import { readOnlyRoutes } from "../../platform/read-only.js";
import { requireViewer } from "../identity/index.js";
import { getPlayerProfile } from "./service.js";

export function playerRoutes(db: Database) {
  const app = readOnlyRoutes();
  app.use("*", requireViewer);

  app.get("/:id", async (c) => {
    const viewer = c.get("viewer");
    if (!viewer) throw invalidInput("No session.");
    return c.json(await getPlayerProfile(db, viewer.id, c.req.param("id")));
  });

  return app;
}
