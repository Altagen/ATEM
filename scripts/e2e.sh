#!/usr/bin/env bash
# The end-to-end tests, then the removal of the accounts they created.
#
# The tests run against a live instance and sign up a fresh account each; left
# there, those accounts filled the directory (13,434 on 2026-09-21). They are
# deleted after every run — pass or fail. A purge never turns a red run green;
# a purge that fails turns the run red, so that it is seen.
#
# The purge reaches the database named by `ATEM_E2E_DATABASE_URL`, or by the
# `DATABASE_URL` of `.env` — the one the development API uses.
set -uo pipefail
cd "$(dirname "$0")/.."

pnpm exec playwright test "$@"
status=$?

if [ -f .env ]; then set -a; source .env; set +a; fi
if ! pnpm --filter @atem/api exec tsx scripts/purge-e2e-accounts.mts; then
  echo "e2e: the test accounts could not be purged." >&2
  [ "$status" -eq 0 ] && status=1
fi
exit "$status"
