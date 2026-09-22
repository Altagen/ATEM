# Development

## Set-up

Node 22, pnpm 9, and Docker or Podman for the database.

```sh
cp .env.example .env          # then set JWT_SECRET and the administrator
./scripts/dev-db.sh up        # PostgreSQL on 127.0.0.1:55432
pnpm install
pnpm --filter @atem/api db:migrate
pnpm --filter @atem/api catalogue:sync   # the card catalogue, once
pnpm dev                                 # front on :5173, API on :3000
```

The database keeps its data: `./scripts/dev-db.sh down` stops it, `reset`
deletes it (after confirmation), `dump` and `restore` copy it.

`ATEM_PORT` moves the API, and the front's proxy follows it from the same
`.env`. `ATEM_API_ORIGIN` overrides the proxy target, for when another instance
holds the port.

`pnpm dev:cert` creates a development certificate so the scanner's camera works
from a phone on the local network; `pnpm dev:web -- --host` then exposes the
front, which otherwise listens on loopback only.

To run the production stack from the sources, add `compose.build.yaml`:

```sh
docker compose -f compose.yaml -f compose.build.yaml up -d --build
```

The scanner's prefix dictionary, `apps/web/public/ocr/set-prefixes.json`, is
derived from the catalogue and committed; `pnpm --filter @atem/api
ocr:build-dict` rebuilds it after a sync brings new sets.

## Layout

```
apps/api          Hono + Drizzle, one folder per module:
                  identity · referential · collection · scanlist · deck
                  social · inbox · player · duel · admin
apps/web          framework-free TypeScript, Vite, plain CSS
packages/shared   contracts, rules and limits used by both sides
docs/             vision, domain model, architecture decisions, roadmap
scripts/          gates and development tooling
e2e/              Playwright, desktop and phone
```

Each module owns its tables and never touches another's; rules in
[`04-structure.md`](04-structure.md).

## Checks

```sh
pnpm check        # every gate, then typecheck and tests (scripts/check-all.sh)
pnpm typecheck
pnpm test
```

`pnpm check` runs the gates first: module boundaries, reached routes, escaping,
content security policy, translations, dead CSS and exports, unstyled classes,
bounded outbound calls, test fixtures, the deployment page. A failing gate says
what and where.

API tests create a throwaway PostgreSQL database, run the migrations, and drop
it on exit, failure included. **Without a reachable database they fail**
instead of passing silently; skip them explicitly with `ATEM_SKIP_DB_TESTS=1`.

## End-to-end tests

```sh
ATEM_E2E_URL=https://localhost:5173 pnpm e2e   # desktop and phone
pnpm e2e:ui                                    # step-by-step explorer
pnpm e2e:shots                                 # review screenshots in e2e/shots/
```

They run against a running instance (`ATEM_E2E_URL`, default
`https://localhost:5174`), one at a time. Each test signs up its own
`@example.test` account; `scripts/e2e.sh` deletes them all afterwards, pass or
fail, from `ATEM_E2E_DATABASE_URL` or else `.env`'s `DATABASE_URL`. Admin tests
use `.env`'s administrator.

**Validate every screen on both profiles as it is written.** An overflowing
grid, a small touch target or an off-screen modal is invisible at 1440 px.

`pnpm e2e:shots` asserts nothing: it captures the main screens on both profiles
for review.

## Card images

Artworks are **downloaded once and served by ATEM**, never hot-linked:
YGOPRODeck requires it (“Failure to do so will result in an IP blacklist”), and
hot-linking would expose every viewer to a third party.

An image is fetched on first request, through the outbound rate limit, then
read from disk. Nothing is pre-fetched. `ATEM_MEDIA_DIR` sets the storage
(`data/media` by default), `ATEM_DISK_RESERVE_BYTES` the free space kept.

With no third-party host, the page runs under a strict content security policy:
`deploy/security-headers.conf`, used by nginx **and** the development server,
so end-to-end tests run under the real policy. `scripts/check-csp.mjs` fails if
the policy loosens or the code needs something it forbids. See ADR-003 and
ADR-010 in [`02-architecture.md`](02-architecture.md).

## Conventions

The repository is in English: identifiers, comments, documentation, commits.
French appears only as data: the dictionary
(`apps/web/src/platform/i18n/fr.ts`), Yu-Gi-Oh! vocabulary, card names in
tests, and interface strings asserted by end-to-end tests.

A comment explains **why** — and the incident behind a choice — never what the
next line does.
