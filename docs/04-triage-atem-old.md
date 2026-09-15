# Triage of ATEM-old, module by module

Verdicts: **TAKE** (as is, give or take imports) · **ADAPT** (the substance is good,
the form changes) · **REDO** · **IGNORE** (outside the priority scope).

Rule: no file is taken without a justification written here. ATEM-old's file names
are quoted as they are in that repository — several are French.

---

## Module `referential` (formerly `catalogue` + `media`)

**Overall verdict: it is ATEM-old's best-kept area.** Comments explaining bugs lived
through, tests replaying the incident rather than the function, clean pure/IO
separation. The module violates no boundary — it is the others that write into it.

| File | Lines | Verdict | Reason |
|---|---|---|---|
| `catalogue/set-code.ts` (+test) | 58 | **TAKE** | Tested pure functions. The FR→EN switch, D4's foundation. |
| `catalogue/debit-sortant.ts` (+test) | 151 | **TAKE** | Token bucket. See “lessons” below — non-negotiable. |
| `catalogue/ygoprodeck.ts` | 202 | **TAKE** | Strict Zod client, handles the API's `400 + {error}`. Tries the EN code first to avoid a wasted round trip. |
| `catalogue/card-mapper.ts` | 44 | **TAKE** | DB→DTO mapping, three documented image fallbacks. |
| `media/cache.ts` | 193 | **TAKE** | Anti-SSRF allowlist, atomic write, disk space check. |
| `media/espace.ts` | 80 | **TAKE** | Tells “cannot measure” apart from “disk full”. |
| `media/paths.ts` | 36 | **TAKE** | Pure path building. |
| `media/*.test.ts` | 204 | **TAKE** | Cause real failures instead of simulating them. |
| `routes/catalogue.ts`, `routes/media.ts` | 109 | **TAKE** | Minimal routes, anchored regexes, path traversal tested. |
| `collection/resolve-queue.ts` (+test) | 522 | **TAKE** | Deferred resolution queue, deduplicated by *(user, code)*. Moves into `referential`. |
| `catalogue/resolve.ts` | 150 | **ADAPT** | Business core to preserve almost word for word. Remove its knowledge of stubs (a concept that does not belong to it). |
| `catalogue/upsert.ts` | 184 | **ADAPT** | `upsertPrint` does `.limit(20)` then filters in memory, while a unique index `(set_code, rarity, language)` exists. Replace with an exact `WHERE`. |
| `catalogue/queries.ts` | 86 | **ADAPT** | Downloads an image **in the request path**, which the rest of the code explicitly forbids itself. To be made asynchronous. |
| `catalogue/sync.ts` | 54 | **ADAPT** | Dump import as a sequential `await` loop over tens of thousands of rows. To be moved to batch inserts. |
| `collection/seed-playset.ts` | 226 | **REDO** | Development script. Reinvents the language regex and its own `setTimeout(120ms)` instead of the shared token bucket. |

### Lessons not to rediscover

**The outbound rate counts the API *and* images together.** A limiter per kind of
call had left image downloads uncounted → YGOPRODeck blacklist. A single token bucket
for everything that goes out.

**Zod silently strips fields absent from the schema.** `linkval` and `linkmarkers`
were missing: every Link card displayed “Link —”. Worse, the first test written to
cover the bug built the object by hand and so tested nothing.
→ **Rule**: any schema over an external API response is tested with the real
payload, never with a rebuilt object.

**The displayed name follows the language of the owned printing, not the
interface's.** An English speaker saw French names because the code did
`nameFr ?? nameEn`. It is a product rule, independent of its implementation.

**The image host allowlist is an anti-SSRF defence, not a detail.** The URL comes
from a third party. Filtering private IPs is not enough — a name can resolve to a
private IP *after* the check. Strict hostname allowlist + mandatory HTTPS.

**The disk space reserve protects PostgreSQL, not the display.** The feared scenario
is the database no longer writing its transaction logs on the same disk.

**The limiter's timer is deliberately not `unref()`.** It looks dirty, it is not:
without it, the sync script ends before the throttling does. Not to be “fixed” by
reflex.

### Trap no. 1: negative-passcode stubs

**The need is legitimate.** `POST /collection` must answer immediately: we cannot
wait for YGOPRODeck in the request path. An unknown card is therefore created right
away as a provisional row, and resolved in the background.

**The encoding is fragile.** The provisional state is flagged by a **negative**
`passcode`, derived from a hash of the set code. That implicit convention is
rewritten by hand in **four modules** (`if (cardId > 0)`), with no type guard:
nothing distinguishes a real passcode from a stub in the `cardId: number` signature.
And a hash collision between two set codes would give the same stub to two different
cards — not proven impossible, not tested.

**Worse: there are three different implementations of the same concept.**
`collection/service.ts` (`createStubPrint`), `decks/service.ts` (direct insert into
`cards` with a different name, `Card ${pc}`), and the `> 0` check scattered across
the catalogue. None knows the other two.

→ **Decision for ATEM**: keep the principle (immediate answer, deferred resolution),
replace the negative passcode with an **explicit state carried by the row**
(`resolve_status`), and have **a single owning function** for creating a provisional
row, exposed by the `referential` module.

### The boundary violation to fix

`collection/service.ts` and `decks/service.ts` **write directly** into the `cards`
and `card_prints` tables, going around the catalogue module. It is the root cause of
the three stub logics.

→ The `referential` module must expose a **write API** (`upsertCard`, `upsertPrint`,
`ensurePlaceholderPrint`) that `collection` and `decks` call. No direct access to the
reference tables from another module. It is the only structural change to make in
this area.

### Test debt to pay before porting

`resolve.ts`, `upsert.ts` and `queries.ts` — the files carrying the subtlest logic —
**have no dedicated unit test**. They are only covered indirectly.
→ Write those tests **before** porting the code, in particular the case “FR code
already known in EN locally → materialise the FR code without a network call”.

---

## Infrastructure and tooling

### ATEM-old's real stack (measured, not declared)

| Layer | Choice | Verdict |
|---|---|---|
| Runtime | Node ≥ 22, pnpm 9.15.0 (corepack), workspaces `apps/*` + `packages/*` | **TAKE** |
| Language | TypeScript 5.7, `strict` + `noUncheckedIndexedAccess` + `noUnused*` | **TAKE** — sound configuration |
| Server | Hono 4 + `@hono/node-server` | **TAKE** |
| Database | PostgreSQL 16, Drizzle ORM 0.45 + drizzle-kit 0.31, `postgres` driver 3.4 | **TAKE** |
| Contracts | Zod, shared through `packages/shared` | **TAKE** |
| Front | Vanilla TypeScript + Vite 6, **no UI framework** (a deliberate, documented choice) | **TAKE** |
| OCR | tesseract.js 5.1.1 — *not an npm dependency*, vendored from jsDelivr with SHA-256 check | **TAKE** |

Production dependencies, exhaustive: `hono`, `@hono/node-server`, `drizzle-orm`,
`postgres`, `zod` on the API side; **zero third-party dependencies** on the web side.
Remarkably sober — no oversizing to purge.

To fix while taking it: zod is `^3.24` on the API side and `^3.25` on the shared side
(a version mismatch to unify), and **no linter or formatter is configured** — a gap,
not a documented choice.

### The major gap: `docker compose up` does not exist

`compose.yaml` carries its own warning: *“Dev-only infrastructure. Not the application
ship stack.”* A single service, `db`. No application image. `Containerfile.build` is a
CI **build** image, not a runtime one.

The deployment actually practised is **bare-metal, systemd + nginx**, in **nine manual
steps** documented in `deploy/README.md`.

→ **Consequence for M0: nothing to adapt, everything to write.** It is the milestone's
goal and it is heavier than I had estimated. `deploy/README.md` remains the best
available specification: it lists exactly what compose will have to automate.

| Element | Verdict |
|---|---|
| `compose.yaml` | **REDO** — dev-only, does not ship the application |
| `Containerfile.build` | **ADAPT** — a good skeleton, to derive runtime images from |
| `deploy/nginx/*.conf` | **TAKE** — CSP justified directive by directive, SSE buffering, media cache |
| `deploy/systemd/*` | **ADAPT** — graceful shutdown and verified backup, to translate into entrypoint and healthcheck |
| `.env.example` | **TAKE** — each variable justified in one sentence, a model to copy |
| `packages/shared` | **TAKE** — pure Zod contracts, split by domain, tested |
| `apps/web/vite.config.ts` | **TAKE** — `/api` and `/media` proxy, self-signed HTTPS in dev (needed by `getUserMedia`, hence by scanning) |
| `scripts/epreuves-api.sh` | **TAKE** — timestamped throwaway Postgres database + throwaway media folder, guaranteed clean-up, orphan database detection |
| `scripts/vendor-tesseract.sh` + `.sha256` | **TAKE** — fingerprint-checked vendoring, motivated by a real CSP incident |
| `scripts/check-*.sh` (~35 gates) | **TAKE the mechanism**, sort the content — many are specific to deferred screens |
| `scripts/lib/navigateur.mjs`, `banc-*.mjs` | **REDO with Playwright** — see below |
| `scripts/ocr-lab/`, `__pycache__/*.pyc`, `avant-communaute.txt` | **IGNORE / do not take** — artefacts committed by accident |

### Tests: a good base, no real end-to-end

Native `node --test` runner with `tsx`, 87 co-located test files. The throwaway test
database of `epreuves-api.sh` is a solid pattern, to take as is.

**There is no Playwright.** The test benches drive Chromium over hand-written CDP,
opportunistically reusing a binary downloaded by a third-party plugin — broken once by
an update of that plugin, impossible to run in CI.

→ The Playwright set-up planned for M1 therefore starts from a blank page. The benches'
**scenario**, though, deserves to be taken: a full throwaway instance mounted before
each campaign, measurement of the real coverage of routes reached by a browser, and
testing with several simultaneous browsers for social flows — which cannot be
validated by testing an isolated route.

**No CI exists** (`.github/` absent). The four gates listed in `AGENTS.md` are run by
hand.

### Operational knowledge to transfer

`docs/CHANTIER-HEBERGEMENT.md` is the densest document of the repository: each
hardening point is described with **the real cause found in production** — rate
limiting bypassable through an unfiltered `X-Forwarded-For`, SSE streams never closed
server-side, listening on all interfaces despite a message announcing the opposite,
no graceful shutdown, no CSP, backups never verified by a restore.
→ To be turned into a **hardening checklist** for ATEM, independently of the
deployment mode.

`antipatterns.md` (in the `all/ATEM/` backbone) lists generic defects observed:
fabricated fallback data (`d.winrate || "65%"`), demo content displayed as an
unconditional fallback, a hand-written migration desynchronising the Drizzle snapshot,
a table declared without a migration → 500 in production. → To carry as is into the
new project's contract.

**Not to be taken as a roadmap**: `BACKLOG.md` is outdated — several items it lists as
open are already done. The `all/ATEM/` backbone partly is too (it claims “Deployment:
none yet” while a systemd deployment has been running since 8 September 2026).

### Two rigour reflexes to keep

ATEM-old's `MEMORY.md` was **deliberately emptied**, with the reason written down:
agents' self-assessments had turned out wrong on verifiable points. `AGENTS.md` draws
two cardinal rules from it — **never fabricate data**, and **never write a prose
project status file**. A project's state is measured by an executable gate, not by a
report written by the one being assessed.

Those two rules apply to me. I carry them into ATEM's contract.

---

## Module `identity` (auth)

**Overall verdict: TAKE almost entirely.** A mature implementation, with nothing
notable to fault.

| File | Verdict | Reason |
|---|---|---|
| `auth/crypto.ts` | **TAKE** | Asynchronous scrypt, parameters **versioned in the hash** (the cost can be raised without invalidating existing hashes), `needsRehash` + opportunistic rehash at sign-in, constant-time comparison. |
| `auth/secret.ts` | **TAKE** | Refuses to start without a valid `JWT_SECRET`, and explicitly rejects, by string equality, the old hard-coded default secret. |
| `auth/token.ts` + `revocation.ts` | **TAKE** | The token carries a **version** re-read from the database at every request → sign-out, password change and suspension really invalidate issued tokens. |
| `auth/cookie.ts` | **TAKE** | `httpOnly` + conditional `Secure` + `SameSite=Strict`, with a non-sensitive indicator cookie so the front knows the sign-in state without reading the token. |
| `auth/csrf.ts` | **TAKE** | Origin check on top of `SameSite`, applied only to writes and only to cookie authentication. |
| `auth/rate-limit.ts` + `magasin-debit.ts` | **TAKE** | Double counter, IP **and** targeted account, sliding window, stored in the database so it survives a restart. |
| `auth/middleware.ts` | **TAKE** | Re-reads role, suspension and token version from the database at every request — no blind trust in the JWT's content. |
| `auth/adresse-appelante.ts` | **ADAPT** | Depends on `X-Forwarded-For`. To re-validate against the new deployment's real reverse proxy — it is exactly the rate-limit bypass vector described in the hosting worksite document. |
| `db/verifier-migrations.ts` | **TAKE** | Refuses to start if the database does not have all expected migrations, telling “missing” apart from “unknown”. |
| `db/client.ts`, `user-tag.ts`, `bootstrap-admin.ts` | **TAKE** | Bounded pool, `prepare:false` justified for PgBouncer, clean failure without `DATABASE_URL`. |
| `db/delete-account.ts` | **ADAPT** | A good policy, but a single function knows `users` **and** the guild tables. To split: each module cleans its own data. |
| `db/seed.ts` | **REDO** | 483 lines of demo data mixing every domain. |

## Module `decks`

| File | Verdict | Reason |
|---|---|---|
| `decks/folders.ts` | **TAKE** | Maximum depth, cycle detection, subtree depth computed before moving, and **re-attaching** children on deletion rather than a destructive cascade. |
| `shared/engine/banlist.ts`, `card-math.ts` | **TAKE** | Pure logic: banlist status, Extra Deck classification. Useful building blocks. |
| `decks/service.ts` | **ADAPT** | Sound CRUD, but see the two gaps below. |
| `routes/decks.ts` | **ADAPT** | Good split, but error handling by **string equality** (`msg === "folder_max_depth"`) — fragile. |
| `shared/deck.ts` | **ADAPT** | Clean Zod contracts; purge `category`. |
| `decks/engine-mirror.test.ts` | **DO NOT PORT** | Checks parity with a manual copy of the engine in the mock-up. Pointless once the mock-up is gone. |

### Gap 1 — the 3-copy rule is not guaranteed

`quantity` is capped at 3 **per row**, in Zod and in the service. But database
uniqueness is `(deck_id, zone, passcode, set_code)`: the same card can therefore exist
on **several rows** — different zones, or a different pinned printing — and total more
than 3 copies. No constraint aggregates.

An aggregated legality engine does exist (`engine/banlist.ts`, `checkDeckAdd`), but it
receives the already computed total and **is never called server-side** to validate a
write. It is a display utility, not a guard.

→ Aggregated validation is **to be written**, server-side, at M2.

### Gap 2 — the “owned / missing” computation does not exist

It was never implemented for decks. The generator that carried that kind of
computation was removed. The only “owned/missing” left concerns identifying scanned
cards, which is a completely different subject.

→ **To be designed from scratch** at M2. `card-math.ts` and `banlist.ts` provide
building blocks, not the computation.

### Gap 3 — no tests on decks

Neither the service, nor folders, nor routes have tests. It is the project's least
covered area, and the one where I just found two functional gaps.

## The missing access checkpoint

`app.ts` stacks middlewares in a correct, documented order, and “admin” authorisation
is properly centralised. “Resource owner” authorisation is a repeated but homogeneous
`eq(x.userId, userId)` — acceptable.

**However, viewing other people's data has no single checkpoint.** Two places compute
friendship and blocking independently: `routes/users.ts` (public profile) and
`routes/community/duellistes.ts`. No shared function. The day other players' decks and
collections must also respect blocking, it would be a third copy.

→ Confirms the rule already set in `02-architecture.md`: **a single function
`canView(viewerId, targetId)`**, owned by the `social` module, called by `decks` and
`collection` before serving the slightest piece of a third party's data. To write at
M4, but the boundary is set from M0.

## Secondary take-over decisions

- `decks.category` is marked `@deprecated` but is still **actively recomputed at every
  write**. Living debt: the column will not be carried over.
- `instanceSettings` is an untyped `text` key-value store, read by scattered `find()`
  calls. To type and centralise.
- **Mixed French/English naming** (`erreurs.ts` next to `service.ts`). To settle for
  ATEM: identifiers and file names in English, comments in French.
  *Superseded on 2026-09-14: everything in the repository is in English, comments and
  documentation included — see `05-structure.md`.*
- No drift between `schema.ts` and the migrations — nothing to mop up on that side.
- **Practice to keep**: ATEM-old's comments almost always explain the *why* and the
  incident behind the choice, not just the *what*. It is the best thing in the
  repository, and it is kept independently of the code.

---

## Module `collection` (+ scanlists, import/export)

**Overall verdict: the area densest in acquired business logic.** The problem is
almost never the logic — it is where it lives.

| File | Verdict | Reason |
|---|---|---|
| `scanlists/service.ts` | **TAKE** | **An exemplary module.** Touches no foreign table: it calls `addToCollection`, the exposed function. It is the pattern to generalise everywhere. |
| `routes/collection.ts` | **TAKE** | Upload size checked **twice** — on `Content-Length` then on the text actually read, against a lying header or `chunked`. |
| `routes/scanlists.ts` (+ test) | **TAKE** | Per-account isolation returning **404, not 403** — does not reveal that someone else's resource exists. |
| `shared/scanlist.ts`, `limits.ts` (+test) | **TAKE** | Single source of limits. The test checks that the interface counter and the server schema decide **exactly the same**, multi-unit UTF-16 emoji included. |
| `collection/service.test.ts` | **TAKE** | Pure test of `nomImprime`, every fallback covered. |
| `collection/consolidation.test.ts` | **TAKE** | Injects a real failure through a `Proxy` on the transaction to prove no copy is lost. Rare and precious. |
| `collection/csv.ts` | **ADAPT** | Solid parsing. But `ALIAS_MAP` and language normalisation are **duplicated** in JS in the mock-up. Must live once, in `packages/shared`. |
| `collection/service.ts` | **ADAPT** | See the violations below. |
| `shared/collection.ts` | **ADAPT** | Schemas to take, but an **upper quantity bound is missing** (see gaps). |
| `shared/card.ts` | **ADAPT** | Mixes the card schema (reference data) and the printing schema (identity). To split. |
| `*-mirror.test.ts`, `scanlist-roundtrip.test.ts` | **REDO, keep the fixtures** | Load mock-up JS into a fake `window`. The mechanism disappears with the monorepo; the test vectors are excellent and come back as they are. |
| `collection/seed-playset.ts` | **REDO** | Goes around the catalogue API with a direct `fetch` to YGOPRODeck. |

### Boundary violations to fix

`collection/service.ts` imports and directly joins `cardPrints`, `cards`, `deckCards`,
`instanceSettings` and `users`. Three fixes:

- `createStubPrint` **writes** into `cards` and `card_prints` → must become a function
  exposed by `referential`.
- `cleanUnusedCatalogueCache` **reads `deck_cards`** to know whether a card is still
  used → must call `isCardUsedInAnyDeck()` exposed by `decks`.
- `normalizeSetCode` / `languageFromSetCode` define the `(set_code, rarity, language)`
  identity that `collection` stores — it is not card data. They move down into
  `packages/shared`.

### Logic to preserve word for word

**Provisional → real consolidation must fit in a single transaction.** Without it, an
interruption between deleting the provisional rows and writing the consolidated row
loses copies — “on an eight-hundred-card import, the window opens eight hundred
times”.

**`addToCollection` never calls a remote service in the request path.** The row is
written immediately as `pending`, and resolution only starts **after** the transaction
commits — otherwise resolution races a write not yet committed.

**Pouring a scanlist is a pure addition, never a reconciliation**, and takes exactly
the same path as a manual addition.

**When creating a scanlist, duplicates are merged**, keeping the first identified
name: “a second reading that recognised nothing must not erase what the first had
identified”.

### Real gaps to fill

1. **No upper quantity bound on the collection side.** `quantity_delta` and `quantity`
   have no ceiling, where scanlists cap at 1000. A CSV with `quantity=999999999` goes
   through.
2. **Inconsistent cache clean-up.** `updateOwnedLine` purges the catalogue cache when
   the quantity drops to zero; `addToCollection` with a negative delta (the “−1”
   button) does not. Orphan printings pile up.
3. **Duplicate `set_code` in the same CSV**: “last line wins” behaviour, unspecified
   and untested, inconsistent with the merging scanlists do.
   → Settled: **merge**, like scanlists.
4. **The UTF-8 BOM is added client-side**, not server-side. A direct link to
   `/export.csv` would therefore produce a file that Excel in a French locale mangles.
   → Settled: **BOM server-side**.
5. **Cardmarket only spells out `fr` and `en`**; other languages come out as ISO codes.

---

## Web front

### The design system: TAKE, it is the best part of the repository

`tokens.css` (174 lines) and `base.css` (1,323 lines) are sound: **zero
`!important`**, no dead selector, and every rule commented with the real problem it
solved. The tokens were extracted *after* measuring (`#f5c542` appeared 104 times in
TS and 85 times in CSS before becoming `--gold`). A named `z-index` scale exists,
added after a bug where an undefined `--z-modal` fell back to `auto`.

**A point to decide: there is no light theme.** `color-scheme: dark` hard-coded, no
`prefers-color-scheme` anywhere. A deliberate stance.

| File | Verdict |
|---|---|
| `styles/tokens.css`, `styles/base.css` | **TAKE** |
| `styles/settings.css` | **ADAPT** — in scope, clean |
| `styles/shared-nav.css` | **ADAPT** — remove the guild and admin entries |
| `styles/collection.css` (2,254 lines) | **ADAPT** — a clean structural half; convert 19 ID selectors into classes |
| `styles/decks.css` | **ADAPT** — two `!important` on literal colours to move to tokens |
| `styles/community.css` (1,548 lines) | **REDO while sorting** — mixes the directory (in scope) and guilds (deferred), and carries two visible generations of style |
| `style.css` (aggregator) | **REDO** — holds the only real debt hotspot: 8 raw, uncommented `!important` |
| `styles/admin.css` | **IGNORE** |

**A major scope trap**: `style.css` imports **from outside `apps/web`**. The `profile`
(255 lines) and `scanlist` (107 lines) sheets, and above all `components/scanner.css`
(348 lines), live in `design/styles/pages/`. Porting only `apps/web/src/` would
silently lose the profile's CSS **and the scanner's**.

**Measured debt**: 330 inline `style="..."` attributes remain in the TS, 46 of them in
`settings/vue.ts` and 25 in `profile/vue.ts` — two screens in the priority scope. The
clean-up was under way and unfinished; do not assume uniform quality from one file to
the next.

### Components: TAKE most of them

`toast.ts`, `confirm-modal.ts` (with the “retype the word” option for destructive
actions), `pager.ts`, `avatar.ts`, `counted-textarea.ts` (a limit without
`maxlength`, so typed text is never silently truncated), `selecteur-langue.ts`,
`service-banner.ts`. Each merged several redundant implementations. `header-nav.ts`
and the inbox components are to be **heavily adapted** or set aside (out of scope).

### Router: TAKE the principle, not the dispatch

`router.ts` is 35 lines; the whole real dispatch is a 250-line `if/else` in
`main.ts`. Readable for ten routes, it will not scale. → Route table.

Two mechanisms to keep at all costs: **`racineNeuve()` replaces the root node** at
every navigation instead of emptying it — without that, a screen left behind keeps
writing into the DOM when a late request returns (a real bug); and `retirerEcoutes()`
unsubscribes global listeners at every route change.

### Internationalisation: TAKE entirely

Two layers. The translation key **is French**, resolved to English by a generated
dictionary, with a fallback on the key and a warning emitted once. And above all
`ygo-i18n.ts`, which translates the **enumerations the API does not localise**: 7
attributes, 25 monster races, 7 Spell/Trap properties, 23 card families — with
monster / spell-trap disambiguation, the API's `race` field serving both.

It is exactly the debt announced in ADR-005, already paid. We take it as is.
*(Since 2026-09-14, English is the key — see the roadmap.)*

### The `check-*` gate suite

About forty home-made scripts (`check-design-dead-css.js`, `check-web-colors.sh`,
`check-styles-en-ligne.mjs`, `check-i18n.sh`…) are **what kept the CSS honest**. Some
carry a numeric ceiling that can only go down.

→ Take the mechanism and sort the content. Porting the CSS without its safeguards
would bring back the debt they prevented.

---

## What was actually taken — status as of 2026-09-09

| Element | Decision | What was done |
|---|---|---|
| `catalogue/set-code.ts` | TAKE → **rewritten** | ATEM-old's split only covered 88.2% of real set codes. The new one covers 100%, and separates the join key from the query code (ADR-007). |
| `auth/*` | **TAKEN** | Versioned-format scrypt, session version in the database, indicator cookie, CSRF guard, double rate counter. Identifiers translated into English, reasoning kept. |
| `catalogue/ygoprodeck.ts` | **TAKEN**, hardened | Zod schema moved to `nullish` after one card in 14,524 turned out to carry `attribute: null`. |
| `debit-sortant.ts` | **TAKEN** | A single token bucket for the API and images. |
| `collection/resolve-queue.ts` | **TAKEN** | Deduplication by *(user, code)*, growing backoff with jitter. |
| Transactional consolidation | **TAKEN** | With its no-lost-copy test. |
| Printed name rule | **TAKEN** | With its test. |
| `collection/ocr.ts` (2,319 lines) | **TAKEN AS IS** | No imports, so no adaptation. Its 46 tests too. |
| `scripts/vendor-tesseract.sh` | **TAKEN** | Fingerprint-checked vendoring. |
| `styles/tokens.css` | **TAKEN, consolidated** | 103 lines instead of 174: a single palette, the second being debt ATEM-old could no longer absorb. |
| `styles/base.css` (1,323 lines) | **REWRITTEN** | 250 lines, strictly what is needed. Three rules taken with their justification. |
| `ygo-i18n.ts` | **TAKEN** | The four enumeration tables, with monster / spell-trap disambiguation. |
| `router.ts` + dispatch | **REWRITTEN** | A route table instead of a 250-line `if/else`. The two mechanisms that mattered — renewed root, unsubscribing — are kept. |
| `scanner.ts` (UI) | **REWRITTEN** | Coupled to the old application. The contract, though, is taken word for word: the OCR proposes, the user confirms. |
| `db/schema.ts` (780 lines) | **SPLIT** | One table file per module, a six-line aggregator. |
| Negative passcodes | **REPLACED** | Nullable `card_passcode` and `resolve_status`, with two database constraints (ADR-008). |
| `compose.yaml` | **REDONE** | ATEM-old's only shipped PostgreSQL. |
| `set-prefixes.json` | **REGENERATED** | From the local catalogue, not copied: ATEM-old's file dated from August. |
| Guilds, inbox, admin, landing | **NOT TAKEN** | Outside the priority scope. |
| `banc-*.mjs` (home-made CDP) | **NOT TAKEN** | Playwright will start from a blank page. |

---

## Taking over the front — 2026-09-09

First attempt discarded: I had written a front “inspired by” rather than taken. ATEM-old's
front had been validated; rewriting it lost that work and recreated its defects
differently.

### Who is authoritative, and where

| Area | Source chosen | Why |
|---|---|---|
| Collection | `apps/web/src/collection/vue.ts` | The `design/pages/collection.html` mock-up is an earlier version, with another set of classes. |
| Authentication | `design/scripts/pages/*.js` (mock-up) | It is a **corrected transcription** of the ported front: `h1` instead of `h2`, a real link instead of a clickable `div`, zero inline styles where the ported one had eighteen. |
| Scanner | `design/styles/components/scanner.css` | `apps/web` imported it without having a copy. |
| Password strength | `packages/shared/src/auth.ts` | See below. |

### What was loaded, and what waits

Taken and shipped: `tokens.css`, `base.css`, `collection.css`, `pages/auth.css`,
`components/scanner.css`, `utilities.css`, and the eleven `.pwd-*` rules extracted from
`components.css`.

Staged in `design/staged/`, **not loaded and so weightless**: `decks.css` (M2),
`settings.css` (M3), `pages/profile.css` (M4), `pages/scanlist.css` (M1 P1),
`shared-nav.css` (inbox and account panel, M3–M4), and `components.css` (the mock-up's
library, from which only the meter was taken).

### Dead CSS, measured and removed

ATEM-old's check is taken (`scripts/check-dead-css.mjs`). It had found 362 dead classes
there, 2,763 lines — a third of the sheets.

| Step | Dead rules |
|---|---|
| Raw import of the 10,564 lines | **1,207** (~6,500 lines) |
| After staging the sheets with no screen | 851 |
| After taking the validated markup | 582 |
| After extracting the meter out of `components.css` | 211 |
| After the purge | **0** |

Shipped today: **3,001 lines of CSS**, 41 kB (9.4 kB compressed). Removed rules are kept
in `design/staged/pruned/`, with their original sheet — not shipped, not lost.

### A rule that lied

The mock-up displayed its own assessment of a password's strength, and ATEM-old had
**four diverging implementations** of it — one on the server, two in the front, one in
the mock-up — held together by “mirror” tests. They did not tell the same story: a
twenty-eight-letter sentence with no digit displayed as “Strong” and was refused on
submit.

`checkPasswordStrength` now lives in `@atem/shared`, **once**. The server applies it,
the meter draws it. The mirror tests no longer have a purpose.

Along the way, our server rule was too weak: it only checked the length, where ATEM-old
required sixteen characters **and** the four families.

### Our deliberate departures

In `design/adjustments.css`, set apart and commented one by one — so we know later what
comes from ATEM-old and what comes from us:

- **Sticky scanner shutter**: the original modal scrolls, and on a phone the shutter
  went below the fold. It is the gesture repeated for every card.
- **Quantity buttons at 44 px by finger**: they are 32 px in the original sheet, while
  `base.css` itself notes the threshold is 44. Coarse pointers only — with a mouse,
  density matters more.
- **Header on two rows below 46 rem**, with `--app-bar-height` following:
  `collection.css` set `top: 3.25rem` “under app-bar”, correct only while the header
  fits on one row.
- **A page title read but not seen**: the original screen has no level-1 heading. The
  mock-up had fixed exactly that defect on the authentication side.

### One more gate

`scripts/check-scan-band.mjs` compares the percentages of `SCAN_ZOOM_BAND` with those of
`.scan-zoom-band`. In ATEM-old, writing them in both places with nothing linking them
had produced a viewfinder showing an area the OCR did not read — “when I scan with OCR
I get *nothing reliable*”.

---

## Squaring up M1 — 2026-09-09

Before opening M2, the collection was reworked until nothing was left lying around.
Four new gates, and what they found.

### The gates

| Gate | What it forbids |
|---|---|
| `check-dead-css.mjs` | A rule styling a class nothing sets |
| `check-dead-exports.mjs` | An export nothing calls, anywhere |
| `check-routes.mjs` | A route neither the front nor a test reaches |
| `check-module-boundaries.mjs` | A module entering another otherwise than through its `index.ts` |
| `check-scan-band.mjs` | An aiming band drawn somewhere other than where the OCR reads |

All run in `pnpm check`.

### What they found — in our own code

**Three boundary crossings.** `collection/service.ts` joined `cards` and `card_prints`
directly: exactly the defect I reproached ATEM-old for, reproduced without noticing.

The cure is not to give up joins — filtering, sorting and paginating on a card's name
requires them. `referential` now exposes **`printIndex`**, a named subquery with stable
columns. Other modules join it like a table, without ever knowing how `cards` and
`card_prints` are built, or being able to write into them.

Two crossings remain and are allowed by name: a *schema* may reference another module's
schema, because a foreign key is a declared relation the database enforces. A *service*
reading another's schema says “I know how its tables are built” — that is what produces
competing logics.

**Six dead exports.** Four came from the OCR engine taken as is: an availability flag, a
loading label, a crop preview and its cutting function, which served ATEM-old's
interface and not ours. Removing the third made the fourth dead in turn, then a
variable — the cascade was followed to the end.

The other two were **test hooks without a test**. The defect was not the function but
the missing test: `secret.test.ts` and `outbound-rate.test.ts` now cover refusing to
start without a valid key and spreading the outbound rate.

**Three routes nothing reached:**
- `GET /health` — used by the compose healthcheck, so invisible to the check. A test
  covers it: proof it works, not only that it exists.
- `PATCH /auth/me/locale` — **removed**. No screen called it: it belongs to account
  settings (M3) and arrived early. It will come back with its screen. *(It came back on
  2026-09-11 with the language switch.)*
- `GET /catalogue/cards/:passcode` — **used**, by completing the sheet with ATEM-old's
  “Other printings” block. “Do I already have it, and in which printing?” comes up in
  front of every card being sorted.

### What the collection had less than ATEM-old, now filled

The attribute, monster type, Spell/Trap property and level icons had not been copied:
the chips were text where theirs carried an image. 504 kB of assets, and two filter
blocks added — **summon type** and **spell/trap property**.

That second distinction required a server-side fix: the API puts a monster's type and a
Spell's property in **the same field** `race`. A “Normal” Trap is not a Normal monster;
the facets now separate them, as ATEM-old did in its interface.

### What stays reported without blocking

31 exports are only used inside their own file. It is not dead code: it is a boundary
pierced for nothing. Most are in the OCR engine taken as is, where reducing them would
make a file we want to keep comparable to its source diverge. The check reports them
without failing.

---

## Navigation shell — 2026-09-10

Structural above all: it is the surface Decks, Settings, Profile and Duellists will hook
onto. Doing it now keeps each screen from reinventing its navigation — and the bar from
ending up lying about the current page.

### The router is the single source of destinations

A route and its place in the navigation are declared **in a single gesture**:

```ts
register("/collection", collectionScreen, {
  requiresSession: true,
  nav: { label: "Collection", icon: "🗃️", group: "main" },
});
```

No list is kept separately. A tab leading nowhere becomes impossible to write — the
classic defect of a bar maintained separately, where the entry is added before the
screen and forgotten after it.

### Three surfaces, one state

| Surface | When |
|---|---|
| Top bar | above 46 rem |
| Bottom bar | below — it **replaces** the first |
| Account sheet | opened by the bottom bar |

Replacing rather than adapting is ATEM-old's choice, and it holds: on a phone, the top
bar only kept the brand, the service status and the avatar — five targets in a 62 px
band, for settings nobody visits over and over. The thumb is at the bottom of the
screen.

Keeping both would have meant two navigations to keep in agreement, one of which ends
up lying. A test checks it: **only one bar visible at a time**.

### The service status, always visible

A pill polls `/health` at startup then every minute. When the server stops answering,
every gesture fails with a different message and you look for the failure in the
application; the pill answers before the question is asked.

### The CSS

The rules for the pill and the account sheet come from `shared-nav.css`. The bottom
bar's lived in a `<style>` tag injected by the component, **every declaration marked
`!important`** — not by choice, but because an injected sheet has to win over those
already loaded. Written in an ordinary sheet, they no longer need it.

### The drawer mode is deleted

Ange's decision, and a sound one: two ways to open the same sheet, one of which brought
nothing. Removed from the shipped sheets **and** from what was set aside — 36 rules, a
stacking token, and the class the sheet still borrowed from it. It will not come back by
accident.

### Two defects found by looking, again

**A hundred pixels of empty space at the top of the mobile screen.** `--app-bar-height`
still reserved 6.25 rem — the top bar's height on two rows, back when it survived on a
phone. It is zero where the bar no longer exists.

**Two rules contradicting each other.** The previous day's adjustment put the top bar
back into a grid below 46 rem, while the new sheet hid it. Loaded after, the first won:
the bar stayed visible. The patch went away along with its reason to exist.

And a false lead ruled out by measurement: the bottom bar looked drawn twice on the
screenshots. The DOM holds only one, and turning off `backdrop-filter` makes the second
disappear — it is the blur compositing badly without a real display.

---

## Parity with ATEM-old's collection — 2026-09-10

Ange pointed out that I had studied the collection and its search bar badly. Checked,
and rightly, on three points I had not seen.

### What I had missed

**ATEM-old has no Catalogue screen.** Ten screens, no catalogue. The one I had built was
an artefact of milestone M0 — the proof search worked — that I had then promoted to the
top of the navigation. It duplicated a function the collection already provides, without
letting you act on what you found: you searched for a card, you found it, and then
nothing.

**The search bar searches the collection**, and compares **three** fields: the name, the
set code **and the passcode**. Mine compared two.

**The add path without a set code already existed, and I had removed it.** The advanced
bar carries a `passcode` field, and `POST /collection` accepts `passcode` and `name` on
top of the code. I had set it aside writing “our add API does not take it” — true, and
backwards reasoning: it was the API that needed completing.

It is the fallback when the set code cannot be read: a damaged card, a sleeve, bad
light. The eight digits at the bottom left stay readable.

### The full inventory, then filled

Seven gaps, not three — the line-by-line inventory of ATEM-old's state showed it:

| | |
|---|---|
| Passcode when adding and searching | added |
| Sort direction | added |
| Comfortable / compact density | added |
| Grouping monsters by type | added |
| Xyz rank filter | added |
| Link rating filter | added |
| Copy note | added, with its route |

Level, rank and Link are now **three exact lists** and not a range: the API stores all
three in the same field, but a rank-4 Xyz is not a level-4 monster, and mixing them
produces a meaningless filter.

The density rules had been purged for lack of use, like the icons before them: they came
back with the function they style.

### A divergence I had introduced without saying so

ATEM-old does not paginate: `GET /collection` returns everything, and the front filters,
sorts and groups in memory. I built server-side pagination with infinite scroll.

**The two defects the review found there** — unreachable pagination, the “Monster”
filter applied after paginating — were consequences of that divergence, not inherited
problems. I had presented them as fixes; it was repairing what I had broken.

Pagination is kept, and it is a choice: beyond a few thousand rows, loading everything
becomes costly for a phone. But it is now recorded as a deliberate departure, with its
reason — not as a given.

### What stays out of scope

The link to the scanlists waits for its screen (M1, P1). The drawer mode is deleted at
Ange's request.

---

## Feedback from the first real trial — 2026-09-10

Four observations from Ange after entering cards by set code. Three defects, one
explanation.

### Four wrong defaults

I had chosen mine without saying so. ATEM-old opens with:

| | ATEM-old | what I had set |
|---|---|---|
| View | **list** | gallery |
| Sort | **name** | recently added |
| Direction | **ascending** | descending |
| Grouping by type | **off** | on |

And above all: **grouping off means no heading at all**, not a single “Monster” heading.
The list comes out in one block, in the sort order and nothing else. Cutting by family
imposes a second ordering key on top of the chosen one, and you no longer find what you
are looking for.

### The pending counter stayed frozen

Removing the last card of an unidentified row left “1 awaiting identification” until a
full reload. `applyDelta` did not refresh the counter; it now does, and a test checks
it.

### The English text was not a defect, its silence was

Checked on Ange's real cards: `ALIN-FR010`, `BLZD-FR021` and `BLZD-FR022` **have no
French version at YGOPRODeck**. They are among the 2,863 without a translation, and
English is the correct fallback.

But nothing said so. English text on a French card is incomprehensible until explained —
you look for the defect in the application. The reference data now exposes
`descFrMissing`, and the sheet announces it: “This card has no French version at
YGOPRODeck”.

It is the reference data that carries this flag, not the screen: only it knows whether
the translation is missing or whether nobody asked for it.

### What works well

Adding by set code in the bar is judged “very smooth”. It is the screen's central
gesture — the one repeated hundreds of times.

---

## Scroll lock — 2026-09-10

Two scrollbars lived side by side as soon as a card was opened full size: the sheet's,
and the collection's behind it. You thought you were scrolling down the card and it was
the page moving — and on closing, you were no longer where you had been.

### The method matters

Setting `overflow: hidden` on `<body>` is enough on a desktop and **does nothing on iOS
Safari**, which keeps scrolling the page. So the body is fixed at its current position
and the scroll is restored on closing. It is the only technique that holds on both, and
scanning will happen on a phone.

The scrollbar's width is given back as padding: otherwise the page gains that width the
moment the bar disappears, and everything jumps to the right.

### The counter too

The filter panel and the sheet can be open one on top of the other. A simple flag would
release the page when closing the second while the first is still there — hence a
counter, and two safeguards:

- `setFilterPanel(true)` is called again **at every chip clicked**; the lock follows the
  real state, not the call, otherwise the count would climb without ever coming down;
- a route change takes the modals away without going through their closing;
  `releaseScroll()` resets the count, failing which the next page would not scroll at
  all.

Four surfaces use it: the sheet, the filter panel, the scanner and the account sheet.

### A test that measured its own side effect

The first version checked `window.scrollY` during the lock. It is **zero by
construction**: the body is fixed, it is no longer scrolled. What you see is visual, and
it is a row's on-screen position that must be measured.

Then the test still failed, by exactly the scroll value. Playwright's `click()` scrolls
the element into view **before** clicking, and reset the page to zero right before the
lock: the test measured its own side effect. `dispatchEvent("click")` fires the event
without touching the scroll.

Two false leads, ruled out by measurement rather than reasoning — the defect was never
in the lock.

---

## Missing French is a delay, not a gap — 2026-09-10

Ange questioned the previous day's conclusion: “are you sure the cards without a French
version don't have the names either? Aspischool is *Banc d'aspis*.” Rightly, and on the
point that matters.

### What the measurement says

`Aspischool` (passcode 12888461) does not exist in YGOPRODeck's French dataset — neither
by identifier nor by name. The French dump is a **strict subset** of the English one:
2,863 cards missing, zero alternative identifiers.

But coverage per set is unambiguous:

| Older sets | | Recent sets | |
|---|---|---|---|
| LOB, MRD, PSV, LON, LTGY, SDK | **100%** | RA05 | 60% |
| | | MP25 | 17% |
| | | MAMO | 22% |
| | | ALIN, CORI, SUDA | **0%** |

**The source is running late, it is not giving up.** And `ALIN` — *Alliance Insight* —
is precisely the set of the card Ange had entered.

### What that changes

My message said “This card has no French version at YGOPRODeck”. Technically true about
the source, and **false** for whoever reads it: the card does have an official French
name.

It now says the card is **not yet** translated in the catalogue, and that a future sync
will fill it in — which is accurate, since `upsertCard` merges localised fields instead
of overwriting them.

The flag also covers the **name**, not only the text: it is what you read first, and no
card has one without the other — checked over the 11,661 translated ones.

### The lesson

I had concluded “these cards have no French version” from three requests answering
“absent”. The question was not *whether* the data is missing, but *why* — and the answer
changed what had to be written on screen. An absence is not a negation.

---

## Card sheet: note and printings — 2026-09-10

### The translation message, shortened

“Not yet translated in the catalogue: YGOPRODeck is running late on recent sets. The
name and text below are the English originals, and a future sync will replace them.”

becomes

“Translation not available yet — name and text in English.”

“Not yet” carries all the meaning; the rest was textual commentary, and it belongs in
this document, not in a sheet you skim.

### The note's label

`.inspect-notes` is a flex row whose children stretch by default: the label took the
full height and its text sat at the top, next to a centred field and button. Three
elements on one line, three alignments. `align-items: center` was enough.

### “Other printings” stands apart

The block came right under the note, with no margin or rule. It now has its spacing and
its rule, and a test checks the gap.

### What the measurement revealed along the way

The block is **2,246 pixels high** for a Blue-Eyes: seventy-eight printings. That is
more than the rest of the sheet put together, and spacing changes nothing about it.

It gets **no** scrolling of its own: a third scrollbar in a sheet that already has one
would be exactly what the lock just fixed. So the title announces the count and the
number of owned printings — “78 · 1 owned” — so the length does not surprise.

The real cure needs a design: sort owned printings first, collapse the rest, allow
ticking one. Ange explicitly postponed it — “for now we just make the important UX clean
first”. The measurement is recorded here so the conversation can pick up from there.
