import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { createDatabase } from "./db/client.js";
import { configureResolveQueue, reresolve } from "./modules/collection/index.js";
import { requireJwtSecret } from "./modules/identity/secret.js";
import { installShutdownHandlers, onShutdown } from "./platform/shutdown.js";

// Les deux exigences de configuration sont vérifiées avant d'ouvrir le port :
// une instance mal configurée doit refuser de servir, pas servir à moitié.
requireJwtSecret();
const { db, sql } = createDatabase();

// La file de résolution rappelle la collection, qui rappelle le référentiel.
// Le branchement se fait ici, au démarrage : aucun des deux modules n'a besoin
// de connaître l'autre à l'import, ce qui évite un cycle de dépendance.
configureResolveQueue((userId, setCode) => reresolve(db, userId, setCode));

const app = createApp(db);
const port = Number(process.env.ATEM_PORT ?? 3000);
const hostname = process.env.ATEM_HOST ?? "127.0.0.1";

const server = serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`[atem] à l'écoute sur http://${hostname}:${info.port}`);
});

installShutdownHandlers();
onShutdown(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await sql.end();
});
