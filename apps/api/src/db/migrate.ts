import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "./client.js";

const { db, sql } = createDatabase();
await migrate(db, { migrationsFolder: "./drizzle" });
await sql.end();
console.log("[atem] migrations appliquées");
