/**
 * Creates a throwaway database, applies the migrations, runs the tests, and
 * destroys everything — even on failure.
 *
 * The `.mts` extension is deliberate: this file lives outside the workspace
 * packages, and without it tsx would compile it to CommonJS, where top-level
 * `await` is refused.
 */
import { spawn } from "node:child_process";
import postgres from "postgres";

const adminUrl = process.env.ATEM_TEST_ADMIN_URL!;
const dbName = `atem_test_${Date.now()}_${process.pid}`;
const testUrl = `${adminUrl.slice(0, adminUrl.lastIndexOf("/"))}/${dbName}`;

const admin = postgres(adminUrl, { max: 1 });

async function reachable(): Promise<boolean> {
  try {
    await admin`select 1`;
    return true;
  } catch {
    return false;
  }
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "inherit", env: { ...process.env, ...env } });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

if (!(await reachable())) {
  console.error(`No database reachable at ${adminUrl} — integration tests skipped.`);
  console.error("Run:  ./scripts/dev-db.sh up");
  await admin.end();
  process.exit(0);
}

await admin.unsafe(`create database "${dbName}"`);
let code = 1;
try {
  const env = { DATABASE_URL: testUrl };
  const migrated = await run("pnpm", ["exec", "tsx", "src/db/migrate.ts"], env);
  if (migrated !== 0) throw new Error("the migrations failed");
  code = await run("node", ["--import", "tsx", "--test", ...process.argv.slice(2)], env);
} finally {
  await admin.unsafe(`drop database if exists "${dbName}" with (force)`);
  await admin.end();
}
process.exit(code);
