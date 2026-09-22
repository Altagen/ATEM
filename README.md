<p align="center">
  <img src="apps/web/public/favicon.svg" alt="ATEM" width="96" height="96" />
</p>

# ATEM

A self-hostable web application for paper Yu-Gi-Oh! players: a digital
inventory of the collection, a deck-building workshop, a community of friends,
and a notebook for the duels played across a real table.

**It never simulates the game's rules.** Faithful reproductions already exist;
ATEM accompanies a game played with real cards. The exact scope, and above all
what is excluded from it, are in [`docs/00-vision.md`](docs/00-vision.md).

## What it does

- **Collection** — add cards by their printed set code, typed or **scanned with
  the phone's camera** (on-device OCR); filters on every property of the card;
  scanlists to inventory a batch before adding it; CSV import and export
  (ATEM, ScanFlip, Cardmarket).
- **Decks** — built from what you own, with the banlist and zone limits
  applied, filed in folders.
- **Community** — a directory of the instance's duellists, friends, blocking,
  an inbox; each player chooses who may see their collection and their decks.
- **Duels** — invite a friend, pick your decks, flip the coin, follow the
  phases and the life points from both phones, record the winner.
- **Administration** — one administrator, declared in the configuration:
  registration open or closed, accounts created, suspended or deleted, and a
  log of what the administrator did.

The interface is in French and English. Card data and artwork come from
[YGOPRODeck](https://ygoprodeck.com); ATEM downloads each artwork once and
serves it itself.

## Running an instance

With Docker or Podman, the published images and two files:

```sh
mkdir atem && cd atem
curl -fsSLO https://raw.githubusercontent.com/Altagen/ATEM/main/compose.yaml
curl -fsSL https://raw.githubusercontent.com/Altagen/ATEM/main/.env.example -o .env
# Edit .env: JWT_SECRET, POSTGRES_PASSWORD, ATEM_ADMIN_EMAIL, ATEM_ADMIN_PASSWORD.

docker compose pull && docker compose up -d
docker compose exec api node dist/modules/referential/sync.js   # the card catalogue, once
```

ATEM then answers on port 8080. Outside `localhost` it **must be served over
HTTPS**, behind a reverse proxy: the session cookie is `Secure`, and browsers
only open the camera on a secure page. Everything else — the configuration
reference, HTTPS, backups, upgrades — is in
[`docs/deployment.md`](docs/deployment.md).

## Working on it

```sh
./scripts/dev-db.sh up        # PostgreSQL for development
pnpm install
pnpm --filter @atem/api db:migrate
pnpm dev                      # front on :5173, API on :3000
```

The development set-up, the tests and the gates are in
[`docs/development.md`](docs/development.md); how a release is made is in
[`docs/releasing.md`](docs/releasing.md).

## Documentation

| Document | Content |
|---|---|
| [`00-vision.md`](docs/00-vision.md) | Scope, personas, and above all the non-goals |
| [`01-domain-model.md`](docs/01-domain-model.md) | The invariant core |
| [`02-architecture.md`](docs/02-architecture.md) | The decisions, with their alternatives and consequences |
| [`03-roadmap.md`](docs/03-roadmap.md) | The milestones, and what was measured at each |
| [`05-structure.md`](docs/05-structure.md) | Module boundaries and conventions |
| [`06-deferred.md`](docs/06-deferred.md) | What is paused, the ideas worth keeping, and what was rejected |
| [`deployment.md`](docs/deployment.md) | Running an instance: configuration, HTTPS, backups, upgrades |
| [`development.md`](docs/development.md) | Working on the code: set-up, tests, gates |
| [`releasing.md`](docs/releasing.md) | Branches, versions, tags and images |
| [`ref-csv-formats.md`](docs/ref-csv-formats.md) | Import/export formats, column by column |
| [`ref-duels.md`](docs/ref-duels.md) | What a duel is here, and what it is not |
| [`ref-ocr.md`](docs/ref-ocr.md) | The scanner's settings, and the measurements behind them |

Security issues: see [`SECURITY.md`](SECURITY.md). Changes between versions:
[`CHANGELOG.md`](CHANGELOG.md).

## Two rules

**Never fabricate data.** No invented fallback value, no demo content displayed
when a request fails. An empty screen is information; a plausible and wrong
screen is not.

**Never write a prose project status file.** A state is measured by an
executable gate, not asserted in a document.

## License

ATEM is free software, under the [GNU Affero General Public License
v3.0](LICENSE): anyone who runs a modified version as a service must offer its
source to the people using it.
