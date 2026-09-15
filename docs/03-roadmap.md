# ATEM — Roadmap

Each milestone is a **vertical** slice, shippable and demonstrable. We only move to
the next once the previous one really runs with `docker compose up`.

At each milestone, a targeted “ATEM-old archaeology” step: we only inspect what
concerns the current milestone, and classify each element **Take / Adapt / Redo**.
No exhaustive map of the old project.

---

## M0 — A skeleton that works  ✅ *finished on 2026-09-09*

**Goal.** `docker compose up` on a blank machine gives an application where you
sign up, sign in, and search for a card in the full reference data.

- Monorepo, compose, database, migrations, minimal CI
- Reference data bootstrap job: 2 dumps → tables → index of normalised set codes
- Background image download, resumable
- Sign-up / sign-in / sign-out (scrypt)
- One page: card search by name, with image *(removed in M1: the Catalogue screen
  it served did not exist in ATEM-old and duplicated the collection — see below)*

**Targeted archaeology.** Monorepo configuration, compose, YGOPRODeck API client,
authentication foundation.

**Done when.** Blank machine → usable application in one command, with no manual
step. The reference data holds the 14,524 cards and 44,517 printings.

### What was checked, not assumed

| Measurement | Result |
|---|---|
| Full catalogue import | **12.4 s** — 14,524 cards, 44,496 printings, 12 malformed codes set aside |
| Resolving a French set code already in the database | **39 ms**, zero network calls |
| Splitting real set codes | **100%** (44,505 / 44,517), against 88.2% for ATEM-old |
| Tests | 11 in `shared`, 7 in `api`, all green *(68 in `api` as of 2026-09-10)* |
| Built front weight | 7.9 kB of JS, 4.5 kB of CSS |

Path validated end to end through the front's proxy: sign-up → cookie session →
search by name → resolution of a French set code.

**Two defects found by running, not by reviewing** — see ADR-007 (the two set code
shapes) and the hardening of the Zod schema: one card out of 14,524 has
`attribute: null`, and a missing field is not a null field.

---

## M1 — Collection *(the heart)*  ✅ *finished on 2026-09-11*

- Search by set code, through the normalised shape (ADR-004) — **P0**
- Add to the collection from the result — **P0**
- Collection grid: `+1` / `-1` per printing, favourite — **P0**
- Full-screen card sheet, all information — **P0**
- Search by name and **full filters** (type, race, attribute, level, atk/def,
  archetype, set, rarity, favourites) — **P0**
- `tesseract.js` OCR scan: capture → recognised set code → manual correction →
  `+1`/`-1` → new capture — **P0**
- Scanlist: independent batch of scans, exportable as JSON, poured into the
  collection on demand — **P1**

**Targeted archaeology.** Grid and card sheet components, OCR settings (image
preprocessing, charset restriction, capture area), filter interface.

**Done when.** A pile of physical cards is inventoried by scanning, end to end,
without touching the database by hand.

### State as of 2026-09-09

**Done and checked** — search and add by set code, grid with `+1` / `−1`,
favourites, full-screen sheet, filters fed by what the collection really holds,
full scan screen. ATEM-old's OCR engine is taken **as is**: 2,319 lines with no
imports, with its 46 tests, all green.

| Measurement | Result |
|---|---|
| Tests | 11 shared · 22 API · 46 OCR — 79 in total, all green |
| Main front chunk | 19.4 kB (7.3 kB compressed) |
| Scanner chunk | 24.4 kB, only loaded when the camera opens |
| OCR prefix dictionary | 650 prefixes, 34,746 numbers, derived from the local catalogue |
| Tesseract engine | vendored, 4 MB, checked by SHA-256 fingerprint |

**Two ATEM-old defects fixed along the way.** The first: an already identified
printing won over a provisional one only by chance, so consolidation never
triggered when rarities differed — found while writing the test, not by reviewing
the code. The second: there was no upper bound on quantities.

**Playwright is in place**, with two profiles — desktop 1440×900 and Pixel 5 — and
**every test runs on both**. 28 tests green, in 18 seconds.

Three defects were found by *looking* at the screen, which no server test would
have revealed:

1. **Names displayed in English on French cards.** After a full import, the
   catalogue only holds English codes; `ensurePlaceholderPrint` returned the English
   printing found by the canonical key instead of materialising the player's code.
   Fixed, with two regression tests.
2. **The navigation bar lagged one action behind.** It updated on clicks, but the
   click comes before the server's answer: right after signing in, it still showed
   “Sign in”. It now follows the route rendering.
3. **The mobile layout.** A header whose three blocks overlapped, a scanner capture
   area so tall it pushed `+1` and `−1` below the fold, an unidentified-card pill
   floating in a corner.

The tests locking them also measure horizontal overflow and touch target size —
44 px minimum, because this screen serves to inventory hundreds of cards by thumb.

**Parity with ATEM-old reached on 2026-09-10** — passcode when adding and searching,
sort direction, density, grouping by type, Xyz rank and Link rating filters, copy
note. The Catalogue screen, which did not exist in ATEM-old and duplicated the
collection without letting you act, is deleted.

**Audit of 2026-09-10.** Run over everything shipped. Fixed: the resolution queue
resumed nothing on restart (109 pending rows were resumed at the first fixed
launch), the `unidentified` state was never written, outbound calls had no timeout,
a 429 only held back the refused call, `?level=abc` answered 500, the body limit did
not hold without `Content-Length`, the scanner left two listeners behind per
opening, `?suite=` went through unchecked, and `check-dead-exports` was blind to the
modules' entire public surface. One more gate: `check-outbound.mjs`.

**Scanning was tried on physical cards on 2026-09-10**, on a phone, over the local
network. It was the last point no test could cover: no test browser has a camera,
and the OCR settings had been measured without the gesture's ergonomics being
measured. Ange's verdict: “the user experience is very comfortable”.

Three defects found there, and nowhere else:

- **the field grabbed focus by itself** after each reading, raising the keyboard
  over the shutter bar — you had to tap beside it to dismiss it before every new
  photo;
- **the “+1” had no colour**, indistinguishable from the “−1” next to it;
- **nothing said the reading was working**: the shutter greyed out, which reads as a
  failure. Its pulse existed in CSS, wired nowhere.

None showed on a computer screen, and no gate could report them. That is the
argument for continuing to validate by finger, screen by screen.

### Scanlists — shipped on 2026-09-11

Inventory a batch without pouring it: a delivery, a trade, a box to sort.

**The batch in progress does not leave the browser.** That is what makes its rule
clean instead of a special case: a batch's “−1” decrements its line, floor at zero,
and cannot reach the collection — there is no path. The line stays visible at zero,
to show what you just cancelled; it is dropped at save time.

**Nothing survives without explicit confirmation** (Ange's decision): no
`localStorage`, no half-state found again three days later without knowing what it
holds. The draft survives in-app navigation and dies with the tab.

**The name never holds up the addition.** The line enters with its set code, which
the browser already holds; a resolution runs in the background with a 2.5 s timeout.
If the name arrives, it lands; otherwise the code stays and says what matters.

The scanner is reused **with no change of logic** — it reports
`{ setCode, quantity, label }` to whoever opened it, instead of returning a
collection object.

Three defects found while building: `resetView()` replaced the state object the
screen had captured (no button answered any more); an asynchronous repaint erased the
typing in progress when a name arrived; and a line's counter carried the page
counter's style, bottom margin included.

**Left to do** — nothing for M1.

### Translations — shipped on 2026-09-11

**The sentence is the key.** `t("My collection")` renders the sentence as is in
English, and its translation in French. Templates stay readable: you read the
sentence, not an identifier to resolve elsewhere. The usual objection — changing the
source sentence silently orphans its translation — does not hold:
`scripts/check-translations.mjs` refuses any string without a translation **and** any
translation nothing uses any more.

*French was the key until 2026-09-14*; the repository is going to GitHub, and nobody
should need French to read the source. The displayed language stays French by
default: a product choice, not a code one.

**The dictionary covers the server too.** The API answers in English — its sentence
is the key; the front translates it before displaying it. That avoids inventing a
distinct error code for each of its thirty sentences — and closes the real trap: a
French screen whose errors speak English.

**The Yu-Gi-Oh! vocabulary is not in it.** `Fish`, `WATER`, `Effect Monster`: in
English, the API's raw value **is** the English. `ygo-labels.ts` therefore only
applies in French. “Poisson” is not an interface sentence.

**The language lives on the account** (`PATCH /auth/me/locale`), not in the browser:
you choose it once, and find it again from one device to the next.

**No plural engine.** French does without here — “ex.” does not agree — and the
English is written to read correctly at any number: “×1” rather than “1 copies”. The
day a sentence does not lend itself to that, something else will be needed.

The gate was hardened four times, each time after **seeing** French on an English
screenshot: short unaccented strings (“Scanner”, “Compact”), interpolated templates
(`textContent = \`${n}/${total} édition(s)\``), `[string, string][]` arrays
(“Attribut”, “Niveau”, “Langue”), `_LABELS` tables (“En ligne”, the scan's stages).
It also reported wrong line numbers — it blanked comments into a single space, which
collapsed the line breaks.

209 strings, all translated.

> Image preprocessing before OCR is the real hard point of this milestone, not
> `tesseract.js` itself. What ATEM-old does here is probably the old project's most
> valuable asset.

---

## Navigation shell  ✅ *2026-09-10*

Outside the milestones, done before M2 because it carries it: top bar, bottom bar on
a phone, account sheet, service status. Destinations come from the router, so a
screen declares its route and its place in a single gesture.

The card sheet's drawer mode is deleted — two ways to open the same thing, one of
which brought nothing.

---

## M2 — Decks

- Folder tree — **P1**
- Deck list, search by name, list / gallery view — **P1**
- Workshop: collection on the left, deck on the right (Main / Extra / Side), list /
  gallery view, deck settings, saving — **P1**
- “Owned / missing” indicator computed according to D3 (sum over all printings)
- Limit checks: 3 copies max, 40–60 in the Main, 15 in the Extra and Side

**Targeted archaeology.** Workshop interface, drag and drop, section rendering.

**Done when.** A deck is built from your collection and reports what is missing.

### State as of 2026-09-12 — demonstrable

A deck is created, filled from the collection, and says whether it is playable.

| Line | |
|---|---|
| Folder tree (P1) | **no** — left out of the slice, to do next |
| Deck list, ready / incomplete state | **yes** |
| Search by name, list / gallery view (P1) | search **yes**, gallery **no** |
| Collection / deck workshop (P1) | **yes** — two panels, which take turns on a phone |
| “Owned / missing” | **yes**, and only when something is missing |
| 3-copy limit | **yes**, guaranteed by a database constraint |
| Zone sizes: 40–60 Main, 15 Extra, 15 Side | **yes** — the maximum refuses, the minimum reports |

**Left to close M2**: deck folders, and the options modal (target sizes per deck).
Neither prevents building a deck. *Folders and the gallery have since shipped
(2026-09-12 and 13, sections below); the options modal remains.*

### A deck's sheet — 2026-09-13

Proposed by Ange, taken from ATEM-old (`renderDetail`): **opening a deck shows it**.
A reading page built like the collection — cover, name, folder, counts, status
sentence, search, list or gallery, zone tabs — and a pencil at the top right leading
to the workshop, `?workshop=1` in the address.

**It is the answer to the read-only need.** A screen whose default version has *no*
writing control makes displaying another player's deck possible without writing a
second screen: hiding the pencil will be enough. That is what ADR-009 says, obtained
through the screen's shape rather than scattered conditions.

Two consequences: the bin leaves the workshop for the sheet — discarding a deck is a
gesture on the object, not on its building — and the collection is now only loaded
for the workshop, the only screen that places cards from it. A card's full record is
requested on opening, once per card: a deck row only carries its name, its artwork
and its banlist status.

**A platform defect found along the way.** Escape no longer closed the card opened
from the sheet: the listener attached to `document` survived the screen's
unmounting, and after two navigations the oldest — which paints into a detached
`root` — answered first. The router now gives each screen an `AbortSignal` aborted
at the next render. The collection screen had the same defect, silently.

### Deck audit — 2026-09-13

Run at Ange's request, before closing. Three dead surfaces removed, and two touch
targets enlarged.

**`notes`.** The route accepted it, validated it, wrote it to the database — and no
screen displayed or sent it. Removed everywhere, column included. Its ceiling
`LIMITS.deckNotes` was actually used for the **note on a collection copy**: renamed
`LIMITS.note`, which is what it is.

**The cover** returned `passcode`, `name` and `image`; the screen only reads the
image. `coverImage: string | null` — a deck whose top card has no artwork falls back
to `null` like an empty deck, and the screen shows the card back in both cases.

**`type` and `frameType`** travelled in every row of every deck without anything
reading them: the question “is this an Extra Deck card?” comes up when adding, on the
record coming from the collection.

**By finger, measured on a Pixel 5** in eight states of the screen: no horizontal
overflow, menus fit in the width. Two targets under 44 px — the “⋯” (40) and the
breadcrumb levels (26 high) — enlarged. What remains under the bar is **the scale of
the whole application**: buttons are 40 px and fields 34 everywhere, collection
screen included. It is a global decision, not a touch-up of the decks page.

### Moving: “here”, and drag and drop — 2026-09-13

Ange, about the destination picker shipped the day before: “rather than having a menu
and selecting the tree in a drop-down (which gets super long when you have lots of
folders) just do it like Google Drive”. Rightly, and it was step 3's weak point: a
drop-down grows with the number of folders, and it forces you to **picture** the tree
instead of looking at it.

**Moving is now a mode, not a window.** You choose “Move…”, a banner opens, you
navigate normally, and “Move here” drops at the place in front of you. Touch
navigation stays the only way to designate a folder — it is the thing that was
polished, so use it.

A deliberate consequence: **the destination also disappears from the creation
window**. The deck is born where you are looking, and moves afterwards like
everything else. The same drop-down was there, with the same defect.

**Defect found by Ange the next day**: “drag and drop doesn't work in list mode?”.
The attribute had not been set on the deck row — a replacement that had failed
silently — and **both drag tests looked at the gallery**. A view without a test
breaks in silence: rows now have two, including a folder dragged into another.

**Drag and drop comes back for the desktop**, as in ATEM-old: folders, the “..” card
and **the breadcrumb** are drop targets. What would be refused does not accept the
drop, so the cursor says so before you let go.

Two details that cannot be guessed: the drop hover is painted **without repainting**
(a repaint on `dragover` would replace the element the browser follows and break off
the gesture), and the refusal displayed by the banner repeats the server's sentence
**word for word** — reading two wordings for the same refusal would make you doubt it
is the same rule.

### The folder explorer — 2026-09-13 *(step 3 of 3)*

One level at a time, breadcrumb, folders first and decks next — ATEM-old's shape, the
one it had itself come back to after unfolding the whole tree at once. Three
departures, each for a reason:

1. **Filing goes through a “⋯” menu, not drag and drop.** Aiming at a target while
   holding a finger down does not work on a phone, and it was the only way to move a
   deck in ATEM-old. *(Drag and drop has since come back for the desktop — see
   above.)*
2. **The search crosses folders.** Searching “dragon” and finding nothing because you
   are in the wrong folder is a wrong answer to a simple question. Each result then
   says where it comes from.
3. **A window replaces `window.prompt`** to create a deck — asked for by Ange. It
   carried the name **and** the destination, which a native prompt cannot do, and the
   deck is born where you are looking rather than created then moved.

**What the screen greys out, the server refuses**: impossible destinations come from
`folderCanHost`, in `@atem/shared`, which the service calls too. That is the lesson of
`checkDeckAdd` in ATEM-old — the same rule written twice ends up diverging, and it is
always the screen that is right too early.

### Folders, server foundation — 2026-09-12 *(step 2 of 3)*

`deck_folders`: `id`, `user_id`, `parent_id`, `name`, timestamps. **No
`sort_order`** — ATEM-old wrote it at every creation and its screen sorted by name
anyway.

Three things ATEM-old did well and that we keep: a maximum depth of three levels,
cycle detection on move (subtree included), and a deletion that **re-attaches** to
the parent instead of cascading. Three that we change:

1. **The database cascade goes.** Its schema declared `on delete cascade` on
   `parent_id` while its service re-attached: two contradictory answers, and the
   database wins as soon as a deletion goes elsewhere. Here the database answers
   nothing, and the service's transaction alone re-attaches. `decks.folder_id` stays
   `set null` — losing the filing can be repaired, losing the decks cannot.
2. **One read instead of twenty.** `depthOf` re-read the whole table at every check,
   three times in a row for one creation.
3. **Two sibling folders no longer share a name** — a `nulls not distinct`
   constraint, without which the rule would not hold at the root, that is, not where
   people create the most.

`category`, ATEM-old's `@deprecated`, does not come back.

Twelve tests, including the one holding route order (`/decks/folders` declared after
`/decks/:id` would be swallowed) and the one checking that deleting your account
takes the whole tree despite the non-cascading `parent_id`.

### Deck previews — 2026-09-12 *(step 1 of 3 of the decks page)*

Ange: “can we tackle the deck page with folders and card previews?”. Split in three:
previews, then the folder foundation, then the explorer.

**The cover is derived, not chosen.** ATEM-old had a `cover_url` column — so a picker
to write, and a fix-up to do when the card leaves the deck. Ours is the card the deck
holds **the most copies of in the Main**, its identity in practice, with ties broken
by passcode so the artwork does not change from one refresh to the next. Zero
columns, zero settings screen. The day choosing your cover becomes a need, the column
is added and this rule becomes the fallback.

Covers go out in **one** query for the whole list, not one per deck. The decks page
opens on the board of artworks; the row list stays one click away, and keeps its
thumbnail.

### The workshop's status sentence — 2026-09-12

Ange: “we are at 4/60, could we say ‘Deck incomplete’ or something like that? we had
a few things like that in ATEM-old”. ATEM-old had two (“unsaved”, “limit exceeded”);
our deck list already carried a “Ready / Incomplete” pill, but the workshop said
nothing.

`deckStatus(counts, missing)`, in `@atem/shared`, returns **a single** verdict,
ordered by severity: `over` (above a limit) → `missing` (the deck holds more copies
than the collection) → `empty` → `short` (below the Main minimum) → `ready`. Three
simultaneous warnings cannot be read; what prevents playing is named first, what is
left to do next.

It also returns **what is needed to write the sentence** — the number to remove, or to
add — so nobody has to subtract in their head: “Deck incomplete: 39 more in the Main
(minimum 40).” And it replaces `deckIsPlayable`, which answered the same question
with yes or no: the list's pill and the workshop's sentence now come from the same
judgement, two screens no longer able to contradict each other.

### No draft — decision of 2026-09-12

Cards are written **at every “±”**, right away. There is no “unsaved” state to commit.

ATEM-old worked on a draft: its workshop kept the deck in memory, displayed “unsaved”
and waited for a button. The transcription brought back the button without the
draft — hence a “Save” that only touched the name, and a “Nothing to save” right after
Ange had removed cards. Enough to believe the removal had been thrown away; it had
not.

Renaming the button “Rename” was not enough, and Ange put a finger on what remained:
“it is odd UX to validate the cards automatically but not the name… either you update
everything or you update nothing, but not just half of it”. **So the workshop no
longer has any save button**: cards leave at the “±”, the name leaves when the typing
settles (700 ms) and when the field hands focus back. The counts bar briefly says
“Saved” after every write — the reverse of ATEM-old's mark, because the invariant is
the reverse.

Writing the name **does not reload the deck**: one word changed, not the cards, and
the full round trip would carry the collection along at every pause in typing.
Emptied, the field takes the deck's name back rather than sending an empty string the
server would refuse: a deck always has a name.

**The notion of a draft is still wanted** (“we would need the notion of a *draft* to
explain that a deck is not finished”, Ange) but it answers another need: saying that
a deck is **being designed**, not that its cards are waiting to be written. To be
designed separately.

**Two rules decided by Ange**, which close two gaps from the triage:

- **A deck counts cards, not printings.** Three Blue-Eyes across three set codes
  remain three Blue-Eyes. That is what makes the ceiling expressible in the
  database — `deck_cards` holds one row per card, and
  `check (main + extra + side between 0 and 3)` refuses the fourth copy. ATEM-old
  identified its rows by `(deck, zone, passcode, set_code)`: the same card lived on
  several rows and totalled six copies. **Gap no. 1 closed by the schema**, not by
  vigilance.
- **A deck is bounded by the collection.** You do not put in a card you do not have,
  so it is playable by construction. **Gap no. 2 — “owned / missing” — disappears by
  decision** rather than by implementation. One case remains that drifts: selling a
  card in use. The shortage is then computed at read time, card by card, and **is
  only reported when there is one** — four owned, three in the deck, one sold:
  nothing happens.

`decks.category` is not carried over: the `@deprecated` column ATEM-old recomputed at
every write.

---

## The repository moves to English — 2026-09-14 to 16

“Everything must be in English, it is a project that will go on GitHub”, Ange. Six
batches, each with every gate and the full test suite green: the translation key
(1), `packages/shared` (2), `apps/api` (3), `apps/web` and the URLs (4), end-to-end
tests, scripts and configuration (5), documentation (6). Commit messages were
rewritten in English before the first push. The interface still displays in French by
default.

Translating meant rereading everything, and the rereading found what no gate saw:

- five interface texts had disappeared from the screen since the first translation
  pass, with valid markup hiding it;
- the dead-CSS gate had never looked inside a `@media` block — nine dead or empty
  rules sat there, and the phone scanner had lost its full-screen layout;
- two end-to-end tests asserted nothing, and the API test harness reported success
  when the database was unreachable.

---

## M3 — Settings & data sovereignty

- Account: email, UUID, creation date, status
- Password change
- FR/EN language and card inspection mode
- CSV export: ATEM, ScanFlip, Cardmarket formats
- CSV import: same formats, merge / replace modes
- Import history with a report of failed rows
- Danger zone: collection reset, full account deletion

**Targeted archaeology.** Exact specifications of the ScanFlip and Cardmarket columns
— format knowledge, not code: to be recovered as is.

**Done when.** A user exports, erases everything, re-imports, and finds their
collection identical.

---

## M4 — Duellists

- Player directory, search by username, friends / online filters
- Preview card: username, icon, badges, link to the profile
- Friend request (send, pending, accept, remove), block
- Viewable public profile
- **Viewing another player's collection and decks**, through the single access
  checkpoint described in “Module boundaries” (02-architecture.md)

The “start a duel” button is present but inactive until the mechanics are scoped.

**Done when.** Two accounts see each other, become friends, and view each other's
collections while respecting their visibility settings.

---

## After M4 — to scope, in this order

1. **Duel mechanics.** Prior decision: shared screen or two synchronised devices.
   Decides whether real time is needed (ADR-006).
2. **Guilds.** Roles, applications, invitations, activity log.
3. **Inbox.** Makes sense once guilds are in place.
4. **Tournaments.** Depends on duels AND guilds.
5. **Administration.** To be reduced before being taken back — ATEM-old's area is
   judged too complex; we will start again from a host's real needs.

---

## Card images served by ATEM — done on 2026-09-16

The domain model's review of 2026-09-16 (decision record R5) found the one gap where
the code, not the document, was wrong: card images were hot-linked from
`images.ygoprodeck.com`. YGOPRODeck's guide requires images to be downloaded and
stored locally — “Failure to do so will result in an IP blacklist” — and ADR-003 had
already decided they would be.

Done:

- an image is downloaded **the first time someone asks for it**, through the outbound
  token bucket, and served from disk afterwards. Nothing is pre-fetched: pulling
  14,524 artworks nobody looks at is the volume the guide warns about;
- `GET /media/cards/<passcode>.jpg`, behind a session — open to anyone, it would let a
  stranger make the instance pull the whole catalogue. Only a passcode-shaped name is
  accepted, and the route sends `Cache-Control: immutable` — a passcode identifies a
  card and its artwork never changes — which nginx passes through untouched;
- every DTO hands the screens `/media/...`, never a remote address, and there is **no
  fallback** to the remote URL: a regression shows as a missing image rather than as a
  silent hot-link;
- a content security policy that allows no outside host — ADR-010, checked by
  `scripts/check-csp.mjs` and exercised by `e2e/security.spec.ts`, which loads an
  artwork and fails if a single request reaches ygoprodeck.com.

ATEM-old's `media/cache.ts`, `espace.ts` and `paths.ts` were triaged **TAKE**: host
allowlist against SSRF, atomic writes, disk space reserve. Two of its defects were
left behind: a download no longer runs inside a request that did not ask for an
image, and the remote-URL fallback is gone.

---

## Still to settle

| Question | Needed for |
|---|---|
| Front / server framework / ORM / database (default: ATEM-old's) | M0 — *settled: ATEM-old's* |
| Favourite at the card or the printing level? | M1 — *settled on 2026-09-16: per printing (R10)* |
| Mode of use of the duel assistant | After M4 |

---

## Foundation before M2 — laid on 2026-09-11

Breakdown asked for by Ange: “which needs come before the others?”

**The missing foundation was not the account, it was the distinction between *owner*
and *viewer*.** See ADR-009. It is the only point whose cost grows with every feature
written before it: writing M2 with the confusion would have meant two modules to take
back instead of one.

Done:

- `ownerId` / `viewerId` separated in every `collection` signature; `scanlist` only
  knows `viewerId` — an undecided batch is private by nature;
- this iteration's access rule, decided by Ange: no RBAC, any session **reads** any
  inventory, only the owner **writes**;
- account deletion, with the inventory of what goes — including `auth_attempts`,
  which does not cascade but whose key carries the address.

**Left out of the foundation, and why.** The avatar and its menu are the container of
the settings, not a foundation. CSV import/export runs in parallel. The profile screen
is a *consumer* of the visibility model, not its prerequisite. Changing the password
and the username are real gaps but block nothing — except the username, which must
come before the duellist directory, not before decks.

**Still open**: the account deletion button (the API is there, the settings screen
will come in M3), and the gate that will make reads of others' data structurally
unwritable — it will be born with its first route rather than set up empty.
