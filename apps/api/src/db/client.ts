/**
 * The database connection.
 *
 * A missing `DATABASE_URL` fails startup rather than the first query: a
 * misconfigured instance must refuse to serve, not serve badly.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { envInt } from "../platform/settings.js";
import * as schema from "./schema.js";

export type Database = ReturnType<typeof createDatabase>["db"];

export function createDatabase(url = process.env.DATABASE_URL) {
  if (!url) {
    throw new Error(
      "DATABASE_URL is required. Example: postgres://atem:password@localhost:5432/atem",
    );
  }

  const sql = postgres(url, {
    max: envInt("ATEM_DB_POOL", 10),
    // Prepared statements do not survive a PgBouncer in transaction mode: it
    // redistributes connections and the prepared statement is no longer there.
    prepare: false,
  });

  return { db: drizzle(sql, { schema }), sql };
}
