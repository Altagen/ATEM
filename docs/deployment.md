# Deployment — running an instance

One instance is **one community**: a group of friends, a club, a shop. It runs
as four containers — PostgreSQL, a one-shot migration, the API, and nginx
serving the front — described by one file, `compose.yaml`, shown in full
[below](#the-compose-file).

## Requirements

- Docker with Compose v2, or Podman with `podman compose`.
- A machine with 1 GB of memory and a few gigabytes of disk: the database is
  small, card artworks weigh about 155 kB each and are downloaded only when
  someone looks at them.
- **HTTPS** as soon as the instance is reached other than on `localhost` —
  see [HTTPS](#https).
- Outbound access to `db.ygoprodeck.com` and `images.ygoprodeck.com`, for the
  card catalogue and the artworks.

## Install

The published images live on GitHub's container registry:
`ghcr.io/altagen/atem-api` and `ghcr.io/altagen/atem-web`, tagged by version
(`0.1.0`), by minor version (`0.1`) and `latest`.

```sh
mkdir atem && cd atem
# The two files, from the release you are installing:
curl -fsSLO https://raw.githubusercontent.com/Altagen/ATEM/0.1.0/compose.yaml
curl -fsSL https://raw.githubusercontent.com/Altagen/ATEM/0.1.0/.env.example -o .env
```

Fill in `.env` — at least the four required values:

```sh
JWT_SECRET=...              # openssl rand -base64 32
ATEM_ADMIN_EMAIL=...        # the administrator's address
ATEM_ADMIN_PASSWORD=...     # 16+ characters: upper, lower, digit, special
POSTGRES_PASSWORD=...       # openssl rand -hex 24
ATEM_VERSION=0.1.0          # pin the release rather than following latest
```

Then:

```sh
docker compose pull
docker compose up -d
docker compose exec api node dist/modules/referential/sync.js
```

The last command fills the card catalogue — two requests to YGOPRODeck, about
14,500 cards and 44,500 printings, under a minute. Run it again from time to
time to pick up new sets; it updates in place.

The application answers on port 8080 (`ATEM_PUBLIC_PORT`). The administrator
signs in with the configured address and password and lands on the console.

**Refusing to start is deliberate.** Without `JWT_SECRET`, the administrator
or the database password, compose stops with a message naming what is missing;
with a weak administrator password, or an administrator address that already
belongs to a player, the API does. An instance never runs half-configured.

## The compose file

This is `compose.yaml` as the release ships it — the file the install above
downloads. Nothing in it needs editing: every value comes from `.env`.

<!-- compose.yaml: begin -->
```yaml
# ATEM — production deployment, with the published images.
#
# This file and a .env (from .env.example) are all an instance needs:
#   docker compose pull
#   docker compose up -d
# ATEM_VERSION picks the release (0.1.0, …); it defaults to the latest one.
# Everything is explained in docs/deployment.md. To build the images from the
# sources instead, add compose.build.yaml (see docs/development.md).

services:
  db:
    image: docker.io/library/postgres:16-alpine
    restart: unless-stopped
    # PostgreSQL starts as root to take ownership of its data directory, then
    # drops to the postgres user: these capabilities are what that needs.
    security_opt: ["no-new-privileges:true"]
    cap_drop: [ALL]
    cap_add: [CHOWN, DAC_OVERRIDE, FOWNER, SETGID, SETUID]
    environment:
      POSTGRES_USER: atem
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required — choose the database password}
      POSTGRES_DB: atem
    volumes:
      - atem_pg_data:/var/lib/postgresql/data
    ports:
      # On the loopback only: for backups and inspection from the host itself,
      # never exposed to the network.
      - "127.0.0.1:${ATEM_DB_PORT:-55432}:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U atem -d atem"]
      interval: 3s
      timeout: 3s
      retries: 20

  # The database schema, brought to the version's before the API starts —
  # at every start, so an upgrade migrates by itself.
  migrate:
    image: ghcr.io/altagen/atem-api:${ATEM_VERSION:-latest}
    command: ["node", "dist/db/migrate.js"]
    restart: "no"
    security_opt: ["no-new-privileges:true"]
    cap_drop: [ALL]
    environment:
      DATABASE_URL: postgres://atem:${POSTGRES_PASSWORD}@db:5432/atem
    depends_on:
      db: { condition: service_healthy }

  api:
    image: ghcr.io/altagen/atem-api:${ATEM_VERSION:-latest}
    restart: unless-stopped
    # An unprivileged user on a port above 1024: no capability at all.
    security_opt: ["no-new-privileges:true"]
    cap_drop: [ALL]
    environment:
      DATABASE_URL: postgres://atem:${POSTGRES_PASSWORD}@db:5432/atem
      JWT_SECRET: ${JWT_SECRET:?JWT_SECRET is required — generate it with “openssl rand -base64 32”}
      # The one administrator: the configuration wins at every start.
      ATEM_ADMIN_EMAIL: ${ATEM_ADMIN_EMAIL:?ATEM_ADMIN_EMAIL is required — the administrator's address}
      ATEM_ADMIN_PASSWORD: ${ATEM_ADMIN_PASSWORD:?ATEM_ADMIN_PASSWORD is required — 16+ characters, upper, lower, digit, special}
      ATEM_ADMIN_NAME: ${ATEM_ADMIN_NAME:-Admin}
      ATEM_HOST: 0.0.0.0
      ATEM_PORT: 3000
      # Card artworks, on a volume: YGOPRODeck blacklists repeated downloads.
      ATEM_MEDIA_DIR: /app/data/media
      # The bundled nginx's range, fixed below, so each visitor is rate-limited
      # on their own address. Add your reverse proxy's address after it.
      ATEM_TRUSTED_PROXIES: ${ATEM_TRUSTED_PROXIES:-10.89.42.0/24}
      ATEM_REGISTER_ATTEMPTS_MAX: ${ATEM_REGISTER_ATTEMPTS_MAX:-5}
      ATEM_LOGIN_ATTEMPTS_MAX: ${ATEM_LOGIN_ATTEMPTS_MAX:-10}
      ATEM_DISK_RESERVE_BYTES: ${ATEM_DISK_RESERVE_BYTES:-209715200}
      ATEM_DB_POOL: ${ATEM_DB_POOL:-10}
    volumes:
      - atem_media:/app/data/media
    depends_on:
      db: { condition: service_healthy }
      migrate: { condition: service_completed_successfully }
    healthcheck:
      test: ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""]
      interval: 5s
      timeout: 3s
      retries: 12

  web:
    image: ghcr.io/altagen/atem-web:${ATEM_VERSION:-latest}
    restart: unless-stopped
    # nginx binds port 80, then drops its workers to the nginx user.
    security_opt: ["no-new-privileges:true"]
    cap_drop: [ALL]
    cap_add: [CHOWN, NET_BIND_SERVICE, SETGID, SETUID]
    ports:
      - "${ATEM_PUBLIC_PORT:-8080}:80"
    depends_on:
      api: { condition: service_healthy }

volumes:
  atem_pg_data:
  atem_media:

# Fixed, so ATEM_TRUSTED_PROXIES can name it on every machine.
networks:
  default:
    ipam:
      config:
        - subnet: 10.89.42.0/24
```
<!-- compose.yaml: end -->

What it sets up:

- **`db`** — PostgreSQL 16, its data on the `atem_pg_data` volume, reachable
  from the host only (`127.0.0.1`), for backups.
- **`migrate`** — runs once at every start, before the API, and brings the
  schema to the version's: upgrading needs no manual step.
- **`api`** — the API, as an unprivileged user with no capability; the card
  artworks on the `atem_media` volume.
- **`web`** — nginx, serving the front and forwarding `/api/` and `/media/` to
  the API, on `ATEM_PUBLIC_PORT`. Put your HTTPS reverse proxy in front of it.
- `restart: unless-stopped`: the instance comes back by itself after a reboot.
- A fixed network range, `10.89.42.0/24`, so `ATEM_TRUSTED_PROXIES` can name
  the bundled nginx on every machine.

## The administrator

There is exactly one, declared in the configuration. At every start the account
is created, or brought back to the configured address, name and password; a
new password ends the sessions opened with the old one, and any other account
found holding the role goes back to being a player.

The administrator only administers. It has no collection, is absent from the
directory, nobody can befriend it, and it reaches nothing but its console. From
there it:

- sees how many players there are, how many are online, how many suspended;
- **opens or closes registration** — closed, only the administrator creates
  accounts, and their owners choose their own password at their first sign-in;
- searches the accounts, suspends (sessions end at once), restores, deletes;
- reads its own log of those actions.

Deleting an account erases everything it held. The duels it recorded stay with
their other player, the deleted side shown as “deleted account”.

## Configuration

Every setting is an environment variable, read from `.env` by compose.

| Variable | Default | Meaning |
|---|---|---|
| `JWT_SECRET` | *required* | Signs the session tokens. 32 characters at least. Changing it signs everyone out. |
| `ATEM_ADMIN_EMAIL` | *required* | The administrator's address. |
| `ATEM_ADMIN_PASSWORD` | *required* | The administrator's password — 16+ characters with an uppercase letter, a lowercase letter, a digit and a special character. |
| `ATEM_ADMIN_NAME` | `Admin` | The administrator's display name. |
| `POSTGRES_PASSWORD` | *required* | The database password. Letters and digits only: it goes into a connection URL. |
| `ATEM_VERSION` | `latest` | The release the images are pulled at. |
| `ATEM_PUBLIC_PORT` | `8080` | The host port the application answers on. |
| `ATEM_DB_PORT` | `55432` | The database's host port, bound to `127.0.0.1` only. |
| `ATEM_REGISTER_ATTEMPTS_MAX` | `5` | Sign-ups per address per hour. |
| `ATEM_LOGIN_ATTEMPTS_MAX` | `10` | Failed sign-ins per address per fifteen minutes. |
| `ATEM_TRUSTED_PROXIES` | `10.89.42.0/24` | Proxies whose `X-Forwarded-For` is believed — see [HTTPS](#https). |
| `ATEM_DISK_RESERVE_BYTES` | `209715200` | Free space always left on the media volume (200 MB): below it, no artwork is downloaded. |
| `ATEM_DB_POOL` | `10` | Database connection pool size. |

Registration being open or closed is not a variable: the administrator switches
it in the console.

## HTTPS

The session cookie is `Secure`, so a browser only keeps it over HTTPS — except
on `localhost`, for development. Browsers also only open the camera, which the
scanner needs, on a secure page. Put a reverse proxy that terminates TLS in
front of port 8080 — Caddy, Traefik, nginx, whatever you run already.

Two things it must do:

- **pass the `Host` header through unchanged**: writes are refused when the
  page's origin and the request's host differ;
- **send `X-Forwarded-For`**, and be declared: add its address to
  `ATEM_TRUSTED_PROXIES`, after the bundled nginx's range —
  `ATEM_TRUSTED_PROXIES=10.89.42.0/24,192.168.1.10`. Without it, every visitor
  appears to come from the proxy, and they all share one rate-limit bucket:
  ten failed sign-ins, anyone's, lock everyone out for fifteen minutes.

A minimal Caddy configuration:

```
atem.example.org {
    reverse_proxy 127.0.0.1:8080
}
```

## Data, and backups

Two volumes hold everything:

- `atem_pg_data` — the database: accounts, collections, decks, duels, the
  card catalogue;
- `atem_media` — the downloaded card artworks. They can be downloaded again,
  but YGOPRODeck blacklists repeated pulls: keep the volume.

The database is the one to back up:

```sh
docker compose exec -T db pg_dump -U atem -d atem -Fc > atem-$(date +%F).dump
```

and to restore, into a fresh instance before its first start of the API:

```sh
docker compose up -d db
docker compose exec -T db pg_restore -U atem -d atem --clean --if-exists < atem-2026-09-22.dump
docker compose up -d
```

## Upgrading

```sh
# In .env: ATEM_VERSION=<the new version>
docker compose pull
docker compose up -d
```

The migration container runs before the API starts, every time: the schema
follows the version. Read the [changelog](../CHANGELOG.md) before a new minor
version, and take a backup first. Going back to an older version after its
migrations have run is not supported — restore the backup instead.

## Building the images yourself

In a clone of the repository, `compose.build.yaml` adds the build lines to the
production file; the images keep their names, so the rest of this page holds:

```sh
docker compose -f compose.yaml -f compose.build.yaml up -d --build
```

## Health

`GET /api/health` answers `{"status":"ok"}` when the API serves requests; the
API container's health check uses it. The logs are the containers' own:
`docker compose logs api`.
