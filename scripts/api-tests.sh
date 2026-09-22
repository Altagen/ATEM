#!/usr/bin/env bash
# The API tests, on a throwaway database.
#
# One database per run, named by timestamp and pid: two simultaneous runs do
# not step on each other, and a test that leaves data behind does not pollute
# the next. The pattern comes from the earlier prototype.
#
# Creation and teardown go through the driver the project already has, not
# through `psql`: the harness must require nothing the repository does not
# install itself.
set -euo pipefail
cd "$(dirname "$0")/.."

export ATEM_TEST_ADMIN_URL="${ATEM_TEST_ADMIN_URL:-postgres://atem:atem@127.0.0.1:55432/postgres}"
export JWT_SECRET="${JWT_SECRET:-test_key_longer_than_thirty_two_characters}"

# The authentication ceilings have their own test, which sets them itself.
# Leaving them at their production value would make tests that are not about
# authentication fail at the fifth sign-up.
export ATEM_REGISTER_ATTEMPTS_MAX="${ATEM_REGISTER_ATTEMPTS_MAX:-10000}"
export ATEM_LOGIN_ATTEMPTS_MAX="${ATEM_LOGIN_ATTEMPTS_MAX:-10000}"

# Paths are relative to apps/api: that is the working directory `pnpm --filter`
# imposes on the launched process.
mapfile -t files < <(cd apps/api && find src -name "*.test.ts" | sort)
if [ ${#files[@]} -eq 0 ]; then
  echo "No API tests yet."
  exit 0
fi

exec pnpm --filter @atem/api exec tsx scripts/run-tests.mts "${files[@]}"
