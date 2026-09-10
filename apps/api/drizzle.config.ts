import type { Config } from "drizzle-kit";

export default {
  // L'agrégateur, pas un fichier de déclaration : chaque module possède ses tables.
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
} satisfies Config;
