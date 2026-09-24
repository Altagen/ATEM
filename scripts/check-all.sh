#!/usr/bin/env bash
# Every gate, from fastest to slowest.
#
# A project's state is measured here, not in a hand-written status file: that
# rule comes from the earlier prototype, which emptied its MEMORY.md after finding that the
# agents' self-assessments were wrong on verifiable points.
set -uo pipefail
cd "$(dirname "$0")/.."

fail=0
failed_steps=()

# The output is set aside and only shown if the step fails, with the names
# recalled at the end.
#
# Steps **no longer** go through `pnpm -s`: `--silent` also suppresses the child
# commands' output, including when they fail. The gate then reported “failed”
# with nothing to show — three times in a row, on an intermittent failure that
# therefore could not be read.
step() {
  printf "\n\033[1m── %s\033[0m\n" "$1"
  local name="$1"
  shift

  local log
  log="$(mktemp)"
  if "$@" >"$log" 2>&1; then
    # Gates that speak on success — a count, a “✓” — keep the floor; test
    # suites have nothing to say when everything passes.
    tail -n 40 "$log"
    rm -f "$log"
    return 0
  fi

  cat "$log"
  rm -f "$log"
  fail=1
  failed_steps+=("$name")
}

step "Scanner aiming band" node scripts/check-scan-band.mjs
step "Module boundaries" node scripts/check-module-boundaries.mjs
step "Reached routes" node scripts/check-routes.mjs
step "Bounded outbound calls" node scripts/check-outbound.mjs
step "Content security policy" node scripts/check-csp.mjs
step "Escaping" node scripts/check-escaping.mjs
step "Translations" node scripts/check-translations.mjs
step "Disjoint test fixtures" node scripts/check-test-fixtures.mjs
step "Dead CSS" node scripts/check-dead-css.mjs
step "Unstyled classes" node scripts/check-unstyled-classes.mjs
step "Dead exports" node scripts/check-dead-exports.mjs
step "Deployment page" node scripts/check-deployment-doc.mjs
step "Deployment settings" node scripts/check-env-example.mjs
step "Types" pnpm typecheck
step "Unit and integration tests" pnpm test

if [ "$fail" -ne 0 ]; then
  printf "\n\033[31m✗ failed gate(s):\033[0m\n"
  for name in "${failed_steps[@]}"; do printf "    %s\n" "$name"; done
  exit 1
fi
printf "\n\033[32m✓ all gates pass\033[0m\n"
