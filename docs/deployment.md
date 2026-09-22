# Deployment

One instance is one community: friends, a club, a shop. It runs as four
containers — PostgreSQL, a one-shot migration, the API, and nginx serving the
front — defined in `compose.yaml`, shown [below](#the-compose-file).

## Requirements

- Docker with Compose v2, or Podman with `podman compose`.
- 1 GB of memory and a few GB of disk. Artworks weigh about 155 kB each and are
  downloaded only when viewed.
- HTTPS for any access other than `localhost` — see [HTTPS](#https).
- Outbound access to `db.ygoprodeck.com` and `images.ygoprodeck.com`.

## Install

Images: `ghcr.io/altagen/atem-api` and `ghcr.io/altagen/atem-web`, tagged
`0.1.0`, `0.1` and `latest`.

```sh
mkdir atem && cd atem
curl -fsSLO https://raw.githubusercontent.com/Altagen/ATEM/0.1.0/compose.yaml
curl -fsSL https://raw.githubusercontent.com/Altagen/ATEM/0.1.0/.env.example -o .env
```

Required values in `.env`:

```sh
JWT_SECRET=...              # openssl rand -base64 32
ATEM_ADMIN_EMAIL=...        # the administrator's address
ATEM_ADMIN_PASSWORD=...     # 16+ characters: upper, lower, digit, special
POSTGRES_PASSWORD=...       # openssl rand -hex 24
ATEM_VERSION=0.1.0          # pin the release instead of following latest
```

Then:

```sh
docker compose pull
docker compose up -d
docker compose exec api node dist/modules/referential/sync.js
```

The last command loads the card catalogue (about 14,500 cards and 44,500
printings, under a minute). Re-run it to pick up new sets; it updates in place.

ATEM listens on port 8080 (`ATEM_PUBLIC_PORT`). The administrator signs in with
the configured address and password.

**Missing or weak settings stop the start.** Compose names a missing
`JWT_SECRET`, administrator or database password; the API refuses a weak
administrator password, or an administrator address already used by a player.

## The compose file

`compose.yaml` as released. Nothing in it needs editing: every value comes from
`.env`.

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

- **`db`** — PostgreSQL 16, data on the `atem_pg_data` volume, reachable from
  the host only (`127.0.0.1`) for backups.
- **`migrate`** — runs before the API at every start and migrates the schema:
  upgrades need no manual step.
- **`api`** — unprivileged, no capabilities; artworks on the `atem_media`
  volume.
- **`web`** — nginx serving the front and forwarding `/api/` and `/media/` to
  the API. Put your HTTPS reverse proxy in front of it.
- A fixed network range, `10.89.42.0/24`, so `ATEM_TRUSTED_PROXIES` can name the
  bundled nginx.

## The administrator

Exactly one, set in the configuration. At every start the account is created or
reset to the configured address, name and password; a new password ends the
old sessions, and any other account holding the role is demoted.

The administrator has no collection, is not in the directory, and reaches only
the console, where it:

- sees player counts: total, online, suspended;
- opens or closes registration — when closed, only the administrator creates
  accounts, and each owner sets their password at first sign-in;
- searches, suspends (sessions end at once), restores and deletes accounts;
- reads the log of its own actions.

Deleting an account erases its data. Its recorded duels stay with the other
player, shown against a “deleted account”.

## Configuration

Environment variables, read from `.env`.

| Variable | Default | Meaning |
|---|---|---|
| `JWT_SECRET` | *required* | Signs session tokens; 32+ characters. Changing it signs everyone out. |
| `ATEM_ADMIN_EMAIL` | *required* | Administrator's address. |
| `ATEM_ADMIN_PASSWORD` | *required* | Administrator's password: 16+ characters, upper, lower, digit, special. |
| `ATEM_ADMIN_NAME` | `Admin` | Administrator's display name. |
| `POSTGRES_PASSWORD` | *required* | Database password. Letters and digits only (it goes in a URL). |
| `ATEM_VERSION` | `latest` | Image release. |
| `ATEM_PUBLIC_PORT` | `8080` | Host port of the application. |
| `ATEM_DB_PORT` | `55432` | Database host port, on `127.0.0.1` only. |
| `ATEM_REGISTER_ATTEMPTS_MAX` | `5` | Sign-ups per address per hour. |
| `ATEM_LOGIN_ATTEMPTS_MAX` | `10` | Failed sign-ins per address per 15 minutes. |
| `ATEM_TRUSTED_PROXIES` | `10.89.42.0/24` | Proxies whose `X-Forwarded-For` is trusted — see [HTTPS](#https). |
| `ATEM_DISK_RESERVE_BYTES` | `209715200` | Free space kept on the media volume (200 MB); below it, no artwork is downloaded. |
| `ATEM_DB_POOL` | `10` | Database connection pool size. |

Open or closed registration is set in the console, not here.

## HTTPS

The session cookie is `Secure`, and browsers only open the camera on secure
pages; both work over HTTPS or on `localhost`. Put a TLS-terminating reverse
proxy (Caddy, Traefik, nginx…) in front of port 8080. It must:

- **pass `Host` unchanged** — writes are refused when origin and host differ;
- **send `X-Forwarded-For` and be listed** in `ATEM_TRUSTED_PROXIES`, after the
  bundled range: `ATEM_TRUSTED_PROXIES=10.89.42.0/24,192.168.1.10`. Otherwise
  every visitor shares the proxy's rate-limit bucket, and ten failed sign-ins
  from anyone lock everyone out for 15 minutes.

Minimal Caddy configuration:

```
atem.example.org {
    reverse_proxy 127.0.0.1:8080
}
```

## Backups

Two volumes:

- `atem_pg_data` — the database: accounts, collections, decks, duels, catalogue;
- `atem_media` — downloaded artworks. Keep it: YGOPRODeck blacklists repeated
  downloads.

Back up the database:

```sh
docker compose exec -T db pg_dump -U atem -d atem -Fc > atem-$(date +%F).dump
```

Restore into a fresh instance, before the API's first start:

```sh
docker compose up -d db
docker compose exec -T db pg_restore -U atem -d atem --clean --if-exists < atem-2026-09-22.dump
docker compose up -d
```

## Upgrading

```sh
# In .env: ATEM_VERSION=<new version>
docker compose pull
docker compose up -d
```

Migrations run before the API at every start. Read the
[changelog](../CHANGELOG.md) and take a backup before a new minor version.
Downgrading after migrations is not supported: restore the backup instead.

## Building the images

From a clone, `compose.build.yaml` adds the build lines; image names stay the
same:

```sh
docker compose -f compose.yaml -f compose.build.yaml up -d --build
```

## Health

`GET /api/health` returns `{"status":"ok"}` when the API serves requests; the
container health check uses it. Logs: `docker compose logs api`.
