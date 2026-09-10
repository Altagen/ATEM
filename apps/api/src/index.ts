import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { createDatabase } from "./db/client.js";
import {
  configureResolveQueue, requeuePendingResolves, reresolve,
} from "./modules/collection/index.js";
import { markUnidentified } from "./modules/referential/index.js";
import { requireJwtSecret } from "./modules/identity/secret.js";
import { installShutdownHandlers, onShutdown } from "./platform/shutdown.js";

// Les deux exigences de configuration sont vérifiées avant d'ouvrir le port :
// une instance mal configurée doit refuser de servir, pas servir à moitié.
requireJwtSecret();
const { db, sql } = createDatabase();

// La file de résolution rappelle la collection, qui rappelle le référentiel.
// Le branchement se fait ici, au démarrage : aucun des deux modules n'a besoin
// de connaître l'autre à l'import, ce qui évite un cycle de dépendance.
configureResolveQueue({
  attempt: (userId, setCode) => reresolve(db, userId, setCode),
  abandon: async (_userId, setCode) => void (await markUnidentified(db, setCode)),
});

const app = createApp(db);
const port = Number(process.env.ATEM_PORT ?? 3000);
const hostname = process.env.ATEM_HOST ?? "127.0.0.1";

const server = serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`[atem] à l'écoute sur http://${hostname}:${info.port}`);
});

/**
 * La file ne vit qu'en mémoire : ce qui attendait à l'arrêt est repris ici.
 *
 * Sans ça, une ligne entrée juste avant un redéploiement restait « en attente
 * d'identification » indéfiniment — sans erreur, sans trace, et sans que rien
 * ne la reprenne jamais. On ne bloque pas l'ouverture du port pour autant : le
 * service doit répondre même si la base met du temps.
 */
void requeuePendingResolves(db)
  .then((count) => {
    if (count > 0) console.log(`[atem] ${count} identification(s) reprise(s) au démarrage`);
  })
  .catch((err) => console.error("[atem] reprise des identifications impossible :", err));

installShutdownHandlers();
onShutdown(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await sql.end();
});
