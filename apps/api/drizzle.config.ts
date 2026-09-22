import type { Config } from "drizzle-kit";

export default {
  // The aggregator, not a declaration file: each module owns its tables.
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
} satisfies Config;
