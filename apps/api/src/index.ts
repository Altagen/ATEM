import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { createDatabase } from "./db/client.js";
import {
  configureResolveQueue, requeuePendingResolves, reresolve,
} from "./modules/collection/index.js";
import { markUnidentified } from "./modules/referential/index.js";
import { requireJwtSecret } from "./modules/identity/secret.js";
import { installShutdownHandlers, onShutdown } from "./platform/shutdown.js";

// Both configuration requirements are checked before opening the port: a
// misconfigured instance must refuse to serve, not serve halfway.
requireJwtSecret();
const { db, sql } = createDatabase();

// The resolve queue calls back into the collection, which calls back into the
// referential. The wiring happens here, at startup: neither module needs to
// know the other at import time, which avoids a dependency cycle.
configureResolveQueue({
  attempt: (userId, setCode) => reresolve(db, userId, setCode),
  abandon: async (_userId, setCode) => void (await markUnidentified(db, setCode)),
});

const app = createApp(db);
const port = Number(process.env.ATEM_PORT ?? 3000);
const hostname = process.env.ATEM_HOST ?? "127.0.0.1";

const server = serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`[atem] listening on http://${hostname}:${info.port}`);
});

/**
 * The queue lives in memory only: whatever was waiting at shutdown is picked up
 * here.
 *
 * Without this, a line entered just before a redeploy stayed “awaiting
 * identification” indefinitely — no error, no trace, and nothing ever picking
 * it up again. We do not hold the port open for it though: the service must
 * answer even if the database is slow.
 */
void requeuePendingResolves(db)
  .then((count) => {
    if (count > 0) console.log(`[atem] ${count} identification(s) resumed at startup`);
  })
  .catch((err) => console.error("[atem] could not resume identifications:", err));

installShutdownHandlers();
onShutdown(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await sql.end();
});
