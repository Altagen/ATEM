/**
 * La connexion à la base.
 *
 * `DATABASE_URL` absente fait échouer le démarrage plutôt que la première
 * requête : une instance mal configurée doit refuser de servir, pas servir mal.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export type Database = ReturnType<typeof createDatabase>["db"];

export function createDatabase(url = process.env.DATABASE_URL) {
  if (!url) {
    throw new Error(
      "DATABASE_URL est requise. Exemple : postgres://atem:motdepasse@localhost:5432/atem",
    );
  }

  const sql = postgres(url, {
    max: Number(process.env.ATEM_DB_POOL ?? 10),
    // Les requêtes préparées ne survivent pas à un PgBouncer en mode transaction :
    // il redistribue les connexions et l'énoncé préparé n'est plus là.
    prepare: false,
  });

  return { db: drizzle(sql, { schema }), sql };
}
