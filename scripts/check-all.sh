#!/usr/bin/env bash
# Toutes les barrières, dans l'ordre du plus rapide au plus lent.
#
# Un état de projet se mesure ici, pas dans un fichier de statut écrit à la
# main : c'est la règle héritée d'ATEM-old, qui avait vidé son MEMORY.md après
# avoir constaté que les auto-évaluations d'agent étaient fausses sur des
# points vérifiables.
set -uo pipefail
cd "$(dirname "$0")/.."

fail=0
step() {
  printf "\n\033[1m── %s\033[0m\n" "$1"
  shift
  if "$@"; then return 0; fi
  fail=1
}

step "Bande de visée du scanner" node scripts/check-scan-band.mjs
step "Frontières de modules" node scripts/check-module-boundaries.mjs
step "Routes atteintes" node scripts/check-routes.mjs
step "CSS mort" node scripts/check-dead-css.mjs
step "Classes sans style" node scripts/check-unstyled-classes.mjs
step "Exports morts" node scripts/check-dead-exports.mjs
step "Types" pnpm -s typecheck
step "Tests unitaires et d'intégration" pnpm -s test

if [ "$fail" -ne 0 ]; then
  printf "\n\033[31m✗ au moins une barrière a cédé\033[0m\n"
  exit 1
fi
printf "\n\033[32m✓ toutes les barrières passent\033[0m\n"
