# ATEM

A self-hostable web service that gives paper Yu-Gi-Oh! players a digital
inventory of their collection, a deck-building workshop, and eventually an
in-person duel assistant.

**It never simulates the game's rules.** Faithful reproductions already exist;
ATEM accompanies a game played with real cards, on a real table. The exact scope,
and above all what is excluded from it, are in
[`docs/00-vision.md`](docs/00-vision.md).

## Getting started

```sh
cp .env.example .env
# JWT_SECRET has no fallback value: without it, the server refuses to start.
echo "JWT_SECRET=$(openssl rand -base64 32)" >> .env
# Nor does the administrator: fill in ATEM_ADMIN_EMAIL and ATEM_ADMIN_PASSWORD
# in .env (16+ characters, upper, lower, digit, special). It signs in at /login
# and lands on the console, where it opens or closes registration and manages
# the accounts.

docker compose up          # or podman compose up
```

The application listens on http://localhost:8080.

The card catalogue is then filled in one command — two requests to YGOPRODeck,
a dozen seconds for 14,524 cards and 44,496 printings:

```sh
pnpm --filter @atem/api catalogue:sync
pnpm --filter @atem/api ocr:build-dict   # the scanner's prefix dictionary
```

## Development

```sh
./scripts/dev-db.sh up                   # PostgreSQL on port 55432
pnpm install
pnpm --filter @atem/api db:migrate
pnpm dev                                 # front on :5173, API on :3000
```

The database keeps its data between runs: `./scripts/dev-db.sh down` stops it without
losing anything, and only `reset` deletes — after asking. `dump` and `restore` take and
replay a copy.

`ATEM_PORT` moves the API, and the front's proxy follows it by reading the same `.env`:
one variable, not two to keep in step. `ATEM_API_ORIGIN` overrides the target outright,
for when another instance already holds the port.

`pnpm dev:cert` makes a development certificate, so the scanner's camera also works
from a phone on the local network — `pnpm dev:web -- --host` then exposes the front,
which otherwise listens on the loopback only.

```sh
pnpm check        # every gate, then typecheck and tests — see scripts/check-all.sh
pnpm typecheck
pnpm test
```

The API tests create a throwaway PostgreSQL database, replay the migrations in
it, and destroy it on exit — including on failure. **Without a reachable
database they fail**, rather than reporting green on tests that did not run; skip
them deliberately with `ATEM_SKIP_DB_TESTS=1`.

### End-to-end tests

```sh
ATEM_E2E_URL=https://localhost:5173 pnpm e2e   # desktop AND mobile, every time
pnpm e2e:ui                                    # the step-by-step explorer
pnpm e2e:shots                                 # review screenshots in e2e/shots/
```

The tests run against a running instance: `ATEM_E2E_URL` points them at it
(`https://localhost:5174` by default). They share it, so they run one at a time.
Each test signs up an account of its own, at `@example.test`; `scripts/e2e.sh`
deletes them all once the run ends, pass or fail, from the database named by
`ATEM_E2E_DATABASE_URL` or else by `.env`'s `DATABASE_URL`.

**Every screen is validated on both profiles when it is written**, never at
integration. An overflowing grid, a touch target too small or a modal running off
the screen are invisible at 1440 px wide, and cost far more once the screen is
considered finished.

`pnpm e2e:shots` tests nothing: it photographs the main screens on both profiles,
to look at them — and to see what moved after a change.

## Card images, and the policy that follows from them

Card artworks are **downloaded once and served by ATEM**, never hot-linked:
YGOPRODeck's guide requires it (“Failure to do so will result in an IP blacklist”),
and every hot-linked image also sent a viewer's browser to a third party.

An image is fetched the first time someone asks for it, through the outbound rate
limit, and read from disk afterwards. Nothing is pre-fetched — the catalogue holds
14,524 cards. Two settings, both optional:

- `ATEM_MEDIA_DIR` — where images are stored. Defaults to `data/media`; in
  production it is a volume, so images survive a redeployment.
- `ATEM_DISK_RESERVE_BYTES` — what is always left free on that disk, 200 MB by
  default. Images stop being written before the disk fills, while there is still
  room to diagnose and clean.

With no outside host left, the page can be closed: one content security policy,
`deploy/security-headers.conf`, included by nginx **and** read by the development
server, so the end-to-end tests run under the real thing. `scripts/check-csp.mjs`
fails if the policy loosens or if the code starts needing something it forbids.
See ADR-003 and ADR-010 in [`02-architecture.md`](docs/02-architecture.md).

## Structure

```
apps/api          modules referential · identity · collection · scanlist · deck
apps/web          framework-free TypeScript, Vite, plain CSS
packages/shared   shared contracts, rules and limits
docs/             vision, domain model, architecture decisions, roadmap
scripts/          executable gates and development tooling
```

Each module owns its tables and never touches another module's. The boundaries
and their reasons are in [`docs/05-structure.md`](docs/05-structure.md).

## Documentation

| Document | Content |
|---|---|
| [`00-vision.md`](docs/00-vision.md) | Scope, personas, and above all the non-goals |
| [`01-domain-model.md`](docs/01-domain-model.md) | The invariant core — the only frozen document |
| [`02-architecture.md`](docs/02-architecture.md) | The decisions, with their alternatives and consequences |
| [`03-roadmap.md`](docs/03-roadmap.md) | The milestones, and what was measured at each |
| [`04-triage-atem-old.md`](docs/04-triage-atem-old.md) | What was taken from the previous project, and why |
| [`05-structure.md`](docs/05-structure.md) | Module boundaries and conventions |
| [`ref-csv-formats.md`](docs/ref-csv-formats.md) | Import/export formats, column by column |
| [`ref-ocr.md`](docs/ref-ocr.md) | The scanner's settings, and the measurements behind them |

## Two rules

Inherited from the previous project, which learned them the hard way:

**Never fabricate data.** No invented fallback value, no demo content displayed
when a request fails. An empty screen is information; a plausible and wrong
screen is not.

**Never write a prose project status file.** A state is measured by an executable
gate. Agents' self-assessments had turned out wrong on verifiable points.
