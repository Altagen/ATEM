#!/usr/bin/env bash
# The development database, in one command.
#
# **The data outlives the container**, and that is the whole point of this file.
#
# It used to run with `--rm` on an anonymous volume: stopping the container
# deleted it, and the volume went with it. Stopping the database — something one
# does to free a port, or before a reboot — silently destroyed every account,
# deck and scanlist. It happened on 2026-09-15, and the empty database that
# followed was first blamed on a cold cache.
#
# So: a **named** volume, which belongs to no container, and no `--rm`. `down`
# stops, `up` finds everything again. Destroying is `reset`, which asks first —
# a gesture you request, never a side effect of stopping.
set -euo pipefail
ENGINE="$(command -v podman || command -v docker)"
NAME=atem-dev-db
VOLUME=atem_dev_db
IMAGE=docker.io/library/postgres:16-alpine
URL="postgres://atem:atem@127.0.0.1:55432/atem"

exists() { "$ENGINE" container exists "$NAME" 2>/dev/null; }
running() { [ "$("$ENGINE" inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null)" = "true" ]; }

wait_ready() {
  printf "waiting"
  for _ in $(seq 1 40); do
    if "$ENGINE" exec "$NAME" pg_isready -U atem -d atem >/dev/null 2>&1; then
      echo " — ready on $URL"; return 0
    fi
    printf "."; sleep 1
  done
  echo " — the database did not start"; return 1
}

case "${1:-up}" in
  up)
    if running; then echo "already up on $URL"; exit 0; fi
    # An existing container is restarted rather than recreated: the volume would
    # be the same either way, but restarting keeps its logs.
    if exists; then "$ENGINE" start "$NAME" >/dev/null; else
      "$ENGINE" run -d --name "$NAME" \
        -e POSTGRES_USER=atem -e POSTGRES_PASSWORD=atem -e POSTGRES_DB=atem \
        -v "$VOLUME":/var/lib/postgresql/data \
        -p 55432:5432 "$IMAGE" >/dev/null
    fi
    wait_ready ;;

  down)
    # Stops and keeps everything. This is the command that used to destroy.
    running && "$ENGINE" stop "$NAME" >/dev/null
    echo "stopped — the data is kept in the “$VOLUME” volume" ;;

  reset)
    # The only way to lose the data, and it says so out loud.
    echo "This deletes every account, deck and scanlist in the development database."
    printf "Type “reset” to confirm: "
    read -r answer
    [ "$answer" = "reset" ] || { echo "nothing done"; exit 1; }
    exists && "$ENGINE" rm -f "$NAME" >/dev/null
    "$ENGINE" volume rm "$VOLUME" >/dev/null 2>&1 || true
    echo "deleted — run “$0 up” for an empty one, then “pnpm db:migrate”" ;;

  dump)
    # A copy before something risky — and what a restore is measured against.
    target="${2:-atem-dev-db-$(date +%Y%m%d-%H%M%S).sql}"
    "$ENGINE" exec "$NAME" pg_dump -U atem -d atem --no-owner > "$target"
    echo "written to $target" ;;

  restore)
    [ -n "${2:-}" ] || { echo "usage: dev-db.sh restore <file.sql>"; exit 1; }
    [ -f "$2" ] || { echo "no such file: $2"; exit 1; }
    # `ON_ERROR_STOP`: a restore that fails halfway must say so, not leave a
    # half-filled database behind and report success.
    "$ENGINE" exec -i "$NAME" psql -U atem -d atem -v ON_ERROR_STOP=1 -q < "$2"
    echo "restored from $2" ;;

  *) echo "usage: dev-db.sh [up|down|reset|dump [file]|restore <file>]"; exit 1 ;;
esac
