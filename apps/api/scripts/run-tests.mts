/**
 * Creates a throwaway database, applies the migrations, runs the tests, and
 * destroys everything — even on failure.
 *
 * **No database is a failure, not a skip.** This script used to print a warning
 * and exit 0 when PostgreSQL was unreachable: `check-all.sh` then announced
 * “all gates pass” while none of the API's integration tests had run. A gate
 * that reports green on what it did not check is worse than no gate. Skipping
 * them is still possible, but it has to be asked for: `ATEM_SKIP_DB_TESTS=1`.
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
  await admin.end();
  if (process.env.ATEM_SKIP_DB_TESTS === "1") {
    console.error(`No database reachable at ${adminUrl} — integration tests skipped on request.`);
    process.exit(0);
  }
  console.error(`✗ No database reachable at ${adminUrl} — the integration tests cannot run.`);
  console.error("  Start it:  ./scripts/dev-db.sh up");
  console.error("  Or skip them deliberately:  ATEM_SKIP_DB_TESTS=1");
  process.exit(1);
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
