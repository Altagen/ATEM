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
failed_steps=()

# La sortie est gardée de côté et montrée seulement si l'étape échoue, avec les
# noms rappelés à la fin.
#
# Les étapes ne passent **plus** par `pnpm -s` : `--silent` supprime aussi la
# sortie des commandes filles, y compris quand elles échouent. La barrière
# annonçait alors « tombée » en n'ayant rien à montrer — trois fois de suite,
# sur un échec intermittent qu'on n'a donc pas pu lire.
step() {
  printf "\n\033[1m── %s\033[0m\n" "$1"
  local name="$1"
  shift

  local log
  log="$(mktemp)"
  if "$@" >"$log" 2>&1; then
    # Les barrières qui parlent en cas de succès — un décompte, un « ✓ » —
    # gardent la parole ; les suites de tests, elles, n'ont rien à dire quand
    # tout passe.
    tail -n 40 "$log"
    rm -f "$log"
    return 0
  fi

  cat "$log"
  rm -f "$log"
  fail=1
  failed_steps+=("$name")
}

step "Bande de visée du scanner" node scripts/check-scan-band.mjs
step "Frontières de modules" node scripts/check-module-boundaries.mjs
step "Routes atteintes" node scripts/check-routes.mjs
step "Appels sortants bornés" node scripts/check-outbound.mjs
step "Traductions" node scripts/check-translations.mjs
step "Jeux d'essai disjoints" node scripts/check-test-fixtures.mjs
step "CSS mort" node scripts/check-dead-css.mjs
step "Classes sans style" node scripts/check-unstyled-classes.mjs
step "Exports morts" node scripts/check-dead-exports.mjs
step "Types" pnpm typecheck
step "Tests unitaires et d'intégration" pnpm test

if [ "$fail" -ne 0 ]; then
  printf "\n\033[31m✗ barrière(s) tombée(s) :\033[0m\n"
  for name in "${failed_steps[@]}"; do printf "    %s\n" "$name"; done
  exit 1
fi
printf "\n\033[32m✓ toutes les barrières passent\033[0m\n"
