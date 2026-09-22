/**
 * Deletes the accounts the end-to-end tests created, and only those.
 *
 * Every e2e test signs up a fresh account, and they piled up in the instance
 * the tests ran against: 13,434 of them on 2026-09-21, around two real ones,
 * showing in the directory and in its online count. The tests' addresses all
 * end in `@example.test` — a domain reserved for testing, which no real person
 * can hold — so that is the one thing this script matches. Everything an
 * account owns goes with it through the foreign keys' cascades.
 *
 * `.mts`, like `run-tests.mts`: top-level `await` outside the packages.
 */
import postgres from "postgres";

const url = process.env.ATEM_E2E_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("purge-e2e-accounts: no ATEM_E2E_DATABASE_URL nor DATABASE_URL.");
  process.exit(1);
}

const sql = postgres(url, { max: 1 });
try {
  const gone = await sql.begin(async (tx) => {
    // Their duels first, whole: between two test accounts there is nobody to
    // keep them for, and left to the foreign keys a recorded duel would be
    // emptied one column at a time and break its own rule mid-way (see
    // `forgetPlayerDuels`).
    await tx`delete from duels where host_id in (select id from users where email like '%@example.test')
                                 or guest_id in (select id from users where email like '%@example.test')`;
    return tx`delete from users where email like '%@example.test'`;
  });
  console.log(`purge-e2e-accounts: ${gone.count} test account(s) deleted.`);
} finally {
  await sql.end();
}
