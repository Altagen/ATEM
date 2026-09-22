# Development

## Set-up

Node 22, pnpm 9, and Docker or Podman for the database.

```sh
cp .env.example .env          # then fill in JWT_SECRET and the administrator
./scripts/dev-db.sh up        # PostgreSQL on 127.0.0.1:55432
pnpm install
pnpm --filter @atem/api db:migrate
pnpm --filter @atem/api catalogue:sync   # the card catalogue, once
pnpm dev                                 # front on :5173, API on :3000
```

The database keeps its data between runs: `./scripts/dev-db.sh down` stops it
without losing anything, and only `reset` deletes — after asking. `dump` and
`restore` take and replay a copy.

`ATEM_PORT` moves the API, and the front's proxy follows it by reading the same
`.env`: one variable, not two to keep in step. `ATEM_API_ORIGIN` overrides the
target outright, for when another instance already holds the port.

`pnpm dev:cert` makes a development certificate, so the scanner's camera also
works from a phone on the local network — `pnpm dev:web -- --host` then exposes
the front, which otherwise listens on the loopback only.

To run the production stack from the sources — the images built from the
working copy rather than pulled — layer `compose.build.yaml` over
`compose.yaml`:

```sh
docker compose -f compose.yaml -f compose.build.yaml up -d --build
```

The scanner's prefix dictionary, `apps/web/public/ocr/set-prefixes.json`, is
derived from the catalogue and committed; `pnpm --filter @atem/api
ocr:build-dict` rebuilds it after a catalogue sync brings new sets.

## Layout

```
apps/api          Hono + Drizzle, one folder per module:
                  identity · referential · collection · scanlist · deck
                  social · inbox · player · duel · admin
apps/web          framework-free TypeScript, Vite, plain CSS
packages/shared   contracts, rules and limits both sides apply
docs/             vision, domain model, architecture decisions, roadmap
scripts/          the gates, and development tooling
e2e/              Playwright, desktop and phone
```

Each module owns its tables and never touches another module's; the rules and
their reasons are in [`05-structure.md`](05-structure.md).

## Checks

```sh
pnpm check        # every gate, then typecheck and tests — scripts/check-all.sh
pnpm typecheck
pnpm test
```

`pnpm check` runs the executable gates before anything else: module boundaries,
reached routes, escaping, the content security policy, translations, dead CSS
and dead exports, unstyled classes, bounded outbound calls, test fixtures. A
gate that fails names what is wrong and where.

The API tests create a throwaway PostgreSQL database, replay the migrations in
it, and destroy it on exit — including on failure. **Without a reachable
database they fail**, rather than reporting green on tests that did not run;
skip them deliberately with `ATEM_SKIP_DB_TESTS=1`.

## End-to-end tests

```sh
ATEM_E2E_URL=https://localhost:5173 pnpm e2e   # desktop AND phone, every time
pnpm e2e:ui                                    # the step-by-step explorer
pnpm e2e:shots                                 # review screenshots in e2e/shots/
```

The tests run against a running instance: `ATEM_E2E_URL` points them at it
(`https://localhost:5174` by default). They share it, so they run one at a
time. Each test signs up an account of its own, at `@example.test`;
`scripts/e2e.sh` deletes them all once the run ends, pass or fail, from the
database named by `ATEM_E2E_DATABASE_URL` or else by `.env`'s `DATABASE_URL`.
The administrator's tests sign in with the `.env`'s administrator.

**Every screen is validated on both profiles when it is written**, never at
integration. An overflowing grid, a touch target too small or a modal running
off the screen are invisible at 1440 px wide, and cost far more once the
screen is considered finished.

`pnpm e2e:shots` tests nothing: it photographs the main screens on both
profiles, to look at them — and to see what moved after a change.

## Card images, and the policy that follows from them

Card artworks are **downloaded once and served by ATEM**, never hot-linked:
YGOPRODeck's guide requires it (“Failure to do so will result in an IP
blacklist”), and every hot-linked image also sent a viewer's browser to a third
party.

An image is fetched the first time someone asks for it, through the outbound
rate limit, and read from disk afterwards. Nothing is pre-fetched.
`ATEM_MEDIA_DIR` says where images are stored (`data/media` by default), and
`ATEM_DISK_RESERVE_BYTES` what is always left free on that disk.

With no outside host left, the page can be closed: one content security policy,
`deploy/security-headers.conf`, included by nginx **and** read by the
development server, so the end-to-end tests run under the real thing.
`scripts/check-csp.mjs` fails if the policy loosens or if the code starts
needing something it forbids. See ADR-003 and ADR-010 in
[`02-architecture.md`](02-architecture.md).

## Conventions

Everything in the repository is written in English — identifiers, comments,
documentation, commit messages. French lives only where it is data: the
dictionary (`apps/web/src/platform/i18n/fr.ts`), the Yu-Gi-Oh! vocabulary, card
names in tests, and the interface strings the end-to-end tests assert.

A comment explains **why**, and the incident behind the choice — never what the
next line does.
