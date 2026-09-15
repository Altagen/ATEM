#!/usr/bin/env bash
# The development database, in one command.
set -euo pipefail
ENGINE="$(command -v podman || command -v docker)"
NAME=atem-dev-db

case "${1:-up}" in
  up)
    "$ENGINE" run -d --rm --name "$NAME" \
      -e POSTGRES_USER=atem -e POSTGRES_PASSWORD=atem -e POSTGRES_DB=atem \
      -p 55432:5432 docker.io/library/postgres:16-alpine >/dev/null
    printf "waiting"
    for _ in $(seq 1 40); do
      if "$ENGINE" exec "$NAME" pg_isready -U atem -d atem >/dev/null 2>&1; then
        echo " — ready on postgres://atem:atem@127.0.0.1:55432/atem"; exit 0
      fi
      printf "."; sleep 1
    done
    echo " — the database did not start"; exit 1 ;;
  down) "$ENGINE" stop "$NAME" >/dev/null && echo "stopped" ;;
  *) echo "usage: dev-db.sh [up|down]"; exit 1 ;;
esac
