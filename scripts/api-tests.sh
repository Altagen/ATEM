#!/usr/bin/env bash
# Les tests de l'API, sur une base jetable.
#
# Une base par exécution, nommée par horodatage et pid : deux campagnes
# simultanées ne se marchent pas dessus, et un test qui laisse des données
# derrière lui ne pollue pas le suivant. Le motif vient d'ATEM-old.
#
# La création et la destruction passent par le driver déjà présent dans le
# projet, pas par `psql` : le harnais ne doit rien exiger que le dépôt
# n'installe lui-même.
set -euo pipefail
cd "$(dirname "$0")/.."

export ATEM_TEST_ADMIN_URL="${ATEM_TEST_ADMIN_URL:-postgres://atem:atem@127.0.0.1:55432/postgres}"
export JWT_SECRET="${JWT_SECRET:-cle_de_test_de_plus_de_trente_deux_caracteres}"

# Les plafonds d'authentification ont leur propre test, qui les fixe lui-même.
# Les laisser à leur valeur de production ferait échouer, à la cinquième
# inscription, des tests qui ne parlent pas d'authentification.
export ATEM_REGISTER_ATTEMPTS_MAX="${ATEM_REGISTER_ATTEMPTS_MAX:-10000}"
export ATEM_LOGIN_ATTEMPTS_MAX="${ATEM_LOGIN_ATTEMPTS_MAX:-10000}"

# Les chemins sont relatifs à apps/api : c'est le répertoire de travail que
# `pnpm --filter` impose au processus lancé.
mapfile -t files < <(cd apps/api && find src -name "*.test.ts" | sort)
if [ ${#files[@]} -eq 0 ]; then
  echo "Aucun test d'API pour l'instant."
  exit 0
fi

exec pnpm --filter @atem/api exec tsx scripts/run-tests.mts "${files[@]}"
