# Monorepo structure and boundaries

## The ailment to treat

ATEM-old declared its 21 tables in **a single 780-line file**, mixing users,
invitations, rate limiting, settings, guilds, notifications, cards, decks and
scanlists. Each table taken alone is sound; it is their cohabitation that poisons.
Direct consequence: three modules wrote into the catalogue tables, each with its
own provisional-card logic, unaware of the other two.

**The boundary is not an aesthetic principle: it is what prevents that drift.**

## Tree

What exists today, and — marked *(planned)* — what the boundaries already make
room for.

```
ATEM/
├─ apps/
│  ├─ api/
│  │  ├─ scripts/            test harness, OCR prefix dictionary
│  │  └─ src/
│  │     ├─ modules/
│  │     │  ├─ referential/  cards, printings, resolution, outbound rate
│  │     │  ├─ identity/     accounts, sessions, passwords, rate limiting
│  │     │  ├─ collection/   owned copies, deferred resolution queue
│  │     │  ├─ scanlist/     batches inventoried outside the collection
│  │     │  ├─ deck/         folders, decks, deck cards
│  │     │  ├─ player/       someone's profile as others see it — read-only
│  │     │  ├─ social/       friendships, blocks, the access checkpoint
│  │     │  ├─ inbox/        what is waiting: the event, never its sentence
│  │     │  ├─ duel/         duels played in person, and their turn-by-turn
│  │     │  ├─ social/       (planned) friendships, blocks, access control
│  │     │  └─ data/         (planned) import, export
│  │     ├─ platform/        errors, headers, graceful shutdown, identifiers, read-only routes
│  │     ├─ db/              client, migrations, schema aggregator
│  │     └─ app.ts
│  └─ web/
│     └─ src/
│        ├─ design/          tokens, base, page and component sheets
│        ├─ screens/         auth/, collection/, scanlist/, deck/, settings/, profile/, shared/
│        ├─ platform/        router, API client, i18n, session, scroll lock
│        └─ main.ts
├─ packages/
│  └─ shared/                rules and limits shared by server and screens
├─ e2e/                      Playwright, desktop and mobile profiles
└─ scripts/                  executable gates, development tooling
```

### Anatomy of a server module

```
modules/<name>/
  schema.ts     its Drizzle tables, and only those
  service.ts    its business logic — the only way in
  routes.ts     its HTTP routes, which only call its service
  <name>.test.ts
  index.ts      its public API: what other modules are allowed to call
```

`db/schema.ts` **is no longer a declaration file**. It is an aggregator that
re-exports the modules' schemas for drizzle-kit. It cannot grow: there is nothing
to write in it.

## The four boundary rules

**R1 — A module never reads or writes another module's tables.** It calls a
function exported by that module's `index.ts`. ATEM-old had a model of this rule
well applied: `scanlists/service.ts` touched no foreign table and went through
`addToCollection`. We generalise that pattern — today `scanlist` pours through
`collection`'s `adjustQuantity`. `scripts/check-module-boundaries.mjs` enforces
it.

**R2 — The referential module exposes a write API.** `upsertCard`, `upsertPrint`,
`ensurePlaceholderPrint`. It is the only cure for the three competing
implementations of the provisional card. `collection` and `deck` do not write into
`cards` and `card_prints`.

**R3 — A single access-control point.** `social` exposes `canView(db, viewerId,
ownerId)`, and it is the only place a block is tested. `player` calls it before
answering a profile; `deck` and `collection` will call it the day their reads open
to other players. ATEM-old already had two independent copies, before other
players' decks and collections were even viewable — the third was guaranteed.

**R4 — A single dependency direction.** As the imports stand today:

```
scanlist ──▶ collection ──▶ referential
                 ▲               ▲
deck ────────────┴───────────────┘
 ▲
player ──▶ identity   (the profile)
  │
  └──────▶ social ──▶ identity   (the relation, and who may look)
              │
              └──▶ inbox ──▶ identity   (what is waiting)

every module's routes ──▶ identity   (the session guard)
```

`player` owns no table: it gathers `identity`'s `getProfile` and `deck`'s
`listDecks`, and only reads.

`identity` depends on nothing, and `referential` only on its session guard, for its
routes. When they arrive, `data` will sit above `collection` and `social` above
`identity`. No cycle. A dependency going back up those arrows is a design defect,
not a special case.

## The provisional card — decision

The need is real: `POST /collection/adjust` must answer immediately, without
waiting for YGOPRODeck. ATEM-old marked the provisional state with a **negative
passcode** derived from a hash of the set code — an implicit convention copied by
hand into four modules, with no type guard, and an untested collision risk.

**ATEM replaces that with an explicit state** carried by the row:

```
resolve_status : 'resolved' | 'pending' | 'unidentified'
```

A single function, `ensurePlaceholderPrint`, owned by `referential`, creates a
provisional row. The sign of an integer no longer carries business meaning.

## Conventions

**Language** — everything in the repository is written in **English**:
identifiers, file and table names, comments, documentation, commit messages,
URLs. The only French lives where it is data: the i18n dictionary
(`apps/web/src/platform/i18n/fr.ts`), the Yu-Gi-Oh! vocabulary
(`platform/ygo-labels.ts`), French card names in test data, and the French
interface strings the end-to-end tests assert. The application itself still
displays in French by default. ATEM-old mixed both languages in its identifiers
(`erreurs.ts` next to `service.ts`), with no rule.

**Comments** — we keep ATEM-old's best practice: a comment explains the *why* and
the incident behind the choice, not the *what*. A comment paraphrasing the code is
useless; a comment saying “pure black and white made 8 and S look alike” avoids
making the mistake again.

**Tests** — co-located, native `node --test` runner. Integration tests on a
throwaway, timestamped PostgreSQL database, destroyed on exit (ATEM-old's
mechanism taken as is).

**Two inherited rules, and they apply to agents too:**
- **Never fabricate data.** No invented fallback, no demo content displayed on
  error.
- **Never write a prose project status file.** A state is measured by an
  executable gate. ATEM-old emptied its `MEMORY.md` precisely because agents'
  self-assessments had turned out wrong on verifiable points.
