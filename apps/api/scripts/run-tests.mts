/**
 * Extension `.mts` volontaire : ce fichier vit hors des paquets du workspace,
 * et sans elle tsx le compilerait en CommonJS, où `await` de premier niveau
 * est refusé.
 */
/**
 * Monte une base jetable, y applique les migrations, lance les tests, détruit
 * tout — même en cas d'échec.
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
  console.error(`Aucune base joignable sur ${adminUrl} — tests d'intégration ignorés.`);
  console.error("Lancez :  ./scripts/dev-db.sh up");
  await admin.end();
  process.exit(0);
}

await admin.unsafe(`create database "${dbName}"`);
let code = 1;
try {
  const env = { DATABASE_URL: testUrl };
  const migrated = await run("pnpm", ["exec", "tsx", "src/db/migrate.ts"], env);
  if (migrated !== 0) throw new Error("les migrations ont échoué");
  code = await run("node", ["--import", "tsx", "--test", ...process.argv.slice(2)], env);
} finally {
  await admin.unsafe(`drop database if exists "${dbName}" with (force)`);
  await admin.end();
}
process.exit(code);
