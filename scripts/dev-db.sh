#!/usr/bin/env bash
# La base de développement, en une commande.
set -euo pipefail
ENGINE="$(command -v podman || command -v docker)"
NAME=atem-dev-db

case "${1:-up}" in
  up)
    "$ENGINE" run -d --rm --name "$NAME" \
      -e POSTGRES_USER=atem -e POSTGRES_PASSWORD=atem -e POSTGRES_DB=atem \
      -p 55432:5432 docker.io/library/postgres:16-alpine >/dev/null
    printf "attente"
    for _ in $(seq 1 40); do
      if "$ENGINE" exec "$NAME" pg_isready -U atem -d atem >/dev/null 2>&1; then
        echo " — prête sur postgres://atem:atem@127.0.0.1:55432/atem"; exit 0
      fi
      printf "."; sleep 1
    done
    echo " — la base n'a pas démarré"; exit 1 ;;
  down) "$ENGINE" stop "$NAME" >/dev/null && echo "arrêtée" ;;
  *) echo "usage: dev-db.sh [up|down]"; exit 1 ;;
esac
