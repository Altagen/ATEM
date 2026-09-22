# ATEM — Architecture decisions

Format: one decision = a context, a choice, its consequences. A decision is revised
by adding an ADR that supersedes it, never by editing it silently. Where facts have
moved since, a dated note says so next to the original text.

---

## ADR-001 — One instance = one community

**Choice.** No multi-tenancy. No notion of “scope” or organisation in queries. The
first intended use is personal or small-group; the community side will enrich the
same data space.

**Consequences.** Simple local auth (email + scrypt password). The administrator is
the host. No query needs to filter by tenant — which removes a whole class of data
leaks. If multi-tenancy is ever needed, it will be a deliberate rewrite of the
access layer, not an adaptation.

---

## ADR-002 — TypeScript end to end, monorepo

**Choice.** pnpm monorepo, TypeScript on the server as on the client, with a package
of domain types shared by both.

**Why.** `tesseract.js` requires JavaScript in the browser for the OCR, which already
fixes the front. Staying in TS on the server maximises reuse of the earlier prototype (interface
components, mock-up, API integration) and avoids duplicating the domain types in two
languages.

**To settle at milestone M0, by looking at what the earlier prototype already uses.** Front
framework, server framework, ORM, database engine. These choices follow the earlier prototype
**by default**, unless inspection reveals they are part of the problem. They are
reversible choices, unlike ADR-001/003/004 — so they do not have to be settled now.

---

## ADR-003 — Lazy resolution, optional mirror *(to settle at M1)*

**Context.** the earlier prototype resolves on demand: `cardsetsinfo.php` on the scanned code,
then `cardinfo.php?id=` for the EN and FR record, then local persistence. A card
already met is never requested again. It works and is proven.

A full mirror remains possible — the whole dump fits in one request (14,524 cards,
21 MB, 22 s measured; 11,661 in FR).

**Choice.** We keep the earlier prototype's **lazy resolution** as the main mechanism. It is
enough for the whole priority path: scan, add, filter your collection — since you
only filter cards you own, hence already resolved.

**What stays open.** The full mirror only becomes necessary if search by **name** has
to cover all 14,524 cards rather than the collection. To settle at M1, when the need
is concrete. It is not a structural choice: the dump import fills the same tables as
lazy resolution.

**What is decided whatever happens.** No display query touches the external API:
everything goes through the local database. Images are cached locally and served by
ATEM, never hot-linked to YGOPRODeck.

> **Done (2026-09-16).** Images are cached and served by ATEM. An artwork is
> downloaded the first time someone asks for it — `GET /media/cards/<passcode>.jpg`,
> behind a session, through the outbound token bucket — then read from disk. Only
> `images.ygoprodeck.com` over HTTPS is downloaded from, and a redirect aborts the
> download: the URL comes from a third party's response, so following it anywhere
> would be request forgery. No fallback to the remote URL, so a regression shows as
> a missing image rather than a silent hot-link. R5 in `01-domain-model.md`.
>
> This is what made ADR-010 possible: with no outside host left, the policy closes.

---

## ADR-004 — Switch to EN for the query, printed code for identity

**Context.** Constraint C2: `cardsetsinfo.php` only knows English codes. `LOB-FR001`
does not answer.

**Choice.** Take the earlier prototype's mechanism: query with the EN equivalent
(`LTGY-FR008` → `LTGY-EN008`), and persist **two** printings — the player's with its
French code, and its English counterpart. Identity of a printing:
`(set_code, rarity, language)`.

**Consequences.** The collection keeps the code really printed on the card — what the
player sees, scans and finds again at export. A scan works whatever the printing
language, without the user having to know it.

**Known limit.** Sets whose numbering differs between regions will not resolve
through this switch. The manual set code correction screen, already planned for
scanning, is the fallback.

---

## ADR-005 — Translating enumerations is our job

**Context.** Constraint C3: the API only localises `name` and `desc`. `type`, `race`,
`attribute` and `frameType` stay in English.

**Choice.** The raw English values are **stored as they are** (they serve as stable
keys for filters and logic). Translation is a label table on the interface side,
maintained in ATEM.

**Consequence.** Collection filters work on the canonical English values,
independently of the displayed language. A filter stays valid when the language
changes.

**Fallback corollary.** 2,863 cards have no French version. In the `fr` locale, the
display falls back to English for those cards, visibly but without error.

---

## ADR-006 — No real-time layer in the skeleton

**Context.** Duel mechanics are deferred, and their mode of use (a shared screen
placed between two players, or two synchronised phones) is not settled. That choice
decides whether real time is needed — but it blocks no priority feature.

**Choice.** The skeleton is pure request/response. No synchronisation infrastructure
is set up.

**What this imposes right now.** The `duel` module exists as an empty, named
boundary, and no priority module writes into its scope. Adding real time later will
be an addition to that module, not a cross-cutting overhaul.

> **Note (2026-09-16).** No `duel` directory exists: git does not track empty
> directories, and an empty module would be dead code. The boundary is kept by the
> rule — no priority module writes into the duel scope — not by a folder.
>
> **Note (2026-09-18).** The module exists now, and the decision holds: duels are
> pure request/response. Two phones around one mat both write to the same duel and
> each sees the other's turns on its next read. `docs/ref-duels.md` says why that
> is enough — ATEM records a duel played in person, it does not referee one.

---

## Module boundaries

Each module owns its tables and exposes an explicit contract. A module **never**
reads another module's tables directly.

```
referential   Card, CardPrint, CardSet, CardImage, CardLocalization, ReferentialImport
              → import, refresh, search, set code resolution
              → READ-ONLY for every other module (D5)

identity      User, UserProfile, sessions
              → sign-up, sign-in, preferences, visibility

collection    CollectionItem, ScanList, ScanListEntry
              → depends on: referential (resolution), identity (owner)

decks         DeckFolder, Deck, DeckEntry
              → depends on: referential (cards), collection (“do I have it?”)

social        Friendship, Block
              → depends on: identity
              → arbitrates read access to other players' collections/decks

data          ImportJob, CSV export, account deletion
              → crosses collection and decks through their contracts, never their tables

duel          (empty — reserved boundary, ADR-006)
guild         (empty — reserved boundary)
```

> **Note (2026-09-16).** As built: scanlists became their own module, `scanlist`,
> which pours through `collection`'s contract; decks live in `deck`; account deletion
> landed in `identity`. `social`, `data`, `duel` and `guild` do not exist yet. The
> current tree and the enforced dependency directions are in `05-structure.md`.

**Cross-reading access rule.** Viewing another player's collection or decks goes
through a single checkpoint combining the visibility declared in `UserProfile` and
the relation in `social` (friendship, block). One implementation, called
everywhere — never a check copied into each endpoint.

---

## ADR-007 — Two set code shapes, not one

**Context.** Discovered by running the real import, not by designing it.

YGOPRODeck's two entry points contradict each other: the full dump writes
`LOB-001`, while `cardsetsinfo.php` answers on `LOB-EN001`. And physical cards carry
one shape or the other depending on their printing year — early English editions had
no region code.

Joining on the English code, as the earlier prototype did, therefore splits two halves of the same
catalogue: a card's sheet displayed “0 printings” while the database held 44,496.

**Choice.** Two distinct shapes, for two uses that have nothing in common:

| Shape | Role | Example |
|---|---|---|
| **canonical** — region removed | **local join** key | `LTGY-FR008` → `LTGY-008` |
| **English** — region switched | **remote query** code | `LTGY-FR008` → `LTGY-EN008` |

Confusing them was the defect. The code printed on the player's card remains the
identity of their printing.

**Checked on real data.** The split covers **100%** of the 44,517 printings, against
88.2% for the earlier prototype's shape — 5,249 more, including every one-letter European edition
(`PSV-E088`) and every number starting with a letter (`NECH-ENS10`, `25YC-ENP01`).
33,935 canonical keys, including **8 collisions** (0.02%), absorbed by the manual
correction screen.

**The 12 codes without a dash** (`DB13`, `DB5`) are malformed at the source: they are
counted and set aside, never guessed.

---

## ADR-008 — An unresolved printing has no card

**Context.** `POST /collection` must answer immediately: the player has just scanned
their card and is waiting for their “+1”. We cannot wait for YGOPRODeck in the
request path.

The earlier prototype solved that by fabricating a card with a **negative passcode**, derived from
a hash of the set code. The convention was implicit, copied by hand into four modules
as `if (cardId > 0)`, with no type guard — and two set codes could produce the same
passcode by collision, which was tested nowhere. There were **three competing
implementations** of it.

**Choice.** `card_prints.card_passcode` is **nullable**. An unresolved printing simply
has no card, and `resolve_status` says so. Two database constraints make the
invariant impossible to violate:

```sql
resolve_status in ('resolved', 'pending', 'unidentified')
(resolve_status = 'resolved') = (card_passcode is not null)
```

No fabricated row, no number whose sign carries meaning, no possible collision. A
single function — `ensurePlaceholderPrint`, exposed by `referential` — creates a
provisional row.

---

## ADR-009 — The owner and the viewer are not the same person

*Decided on 2026-09-11, before M2.*

**Context.** Every service was written `(db, userId, …)`, and that `userId` meant two
things at once: *who this data belongs to* and *who is asking for it*. The code was
safe — but **safe by accident**: it held because you could not be someone else.
Twelve queries filtered on it.

Yet Ange's priorities include, right after decks, “viewing other players' profiles,
decks and collections”. The day a read route carries another player's identity in
its path, every query that forgot to tell the two apart becomes a leak — and a
`POST` copying that pattern would let anyone write into anyone's data.

Writing M2 with the confusion means two modules to take back instead of one. Taking
back a security filter afterwards, on code that works, is exactly the path that made
The earlier prototype untenable.

**Choice.** Two names, and they no longer mix:

| | |
|---|---|
| `ownerId` | who the data belongs to. A **read** takes it. |
| `viewerId` | who is asking, as the session establishes it. A **write** takes it, and only it. |

**The access rule, for this iteration** (decided by Ange): no RBAC. Any session may
**read** anyone's collection and decks. Only the owner **writes**. A visibility
setting will come later; it will sit on the read path, which is already the only
place to filter it.

**Addendum of 2026-09-21 — the visibility setting.** It came with the end of M4, where
this said it would: on the read path. Each account holds a visibility for its
collection and one for its decks — everyone, friends (default), only me — and
`social`'s `canView(db, viewerId, ownerId, scope)` is the one place that reads it.
Only the owner writes, as before.

**What stays private.** A scanlist is not shared: a batch not decided yet is a draft
decision, not an inventory. That module therefore only knows `viewerId`, and has no
notion of owner.

**What the rule forbids, and what must be made impossible.** A write must **never**
receive an identity coming from the request path. Today no route carries someone
else's identity, so there is nothing to guard; when Duellists arrive, those reads
will be mounted on a subset that structurally refuses anything but `GET`, rather
than relying on review vigilance. The gate will be born with its first consumer —
setting up a guard that guards nothing right now would be dead code.

**Addendum of 2026-09-17 — the first consumer.** `GET /players/:id`, a profile as
anyone signed in sees it, is the first route carrying someone else's identity. It is
mounted on `readOnlyRoutes()` (`platform/read-only.ts`), which refuses every method
but `GET` and `HEAD` with a 405 **before** any route runs — so a write added to that
tree later is refused whatever it does. Tested with a path that has no handler at
all. The profile itself is written through `PATCH /auth/me`, which takes the
session's identity and nothing from the path.

**The owner and the visitor on screen — one rule for every resource.** Asked for by
Ange on 2026-09-17: “only a player can modify their own information”, for the
profile now and for decks and collections the day they are shown to others. Three
layers, always the same:

1. **The server says who is looking.** A read of anything that can be someone
   else's carries `isOwner`, computed from the session against the owner — never
   guessed by the screen from an identifier in the address.
2. **The screen shows editing only to the owner.** Every edit control sits in a
   `when(isOwner, …)`, and its handler checks `isOwner` again before opening
   anything. A visitor sees the resource, not the pencil.
3. **The write refuses anyone else**, whatever the screen shows: writes take the
   session's identity (`viewerId`), never the path's.

Layers 1 and 2 are courtesy; layer 3 is the protection, and it is already in place
for decks, folders, collection and profile. The profile is the first screen with a
visitor, and follows the rule (`GET /players/:id`). Decks and collections follow it
when their reads open to others (M4) — adding an `isOwner` to them before then would
be the always-true field described above.

**Addendum of 2026-09-13 — 404 on read, 403 on write.** Asked for by Ange: “even if
you try to go to the route to edit it, in the end you get a 403”.

The two refusals do not say the same thing, and the difference depends on the
direction. A refused **read** answers “not found”: confirming a deck exists would
already be a leak as long as you are not allowed to see it. A refused **write**
answers “this deck is not yours” — because the day you look at another player's
deck, it is in front of you, and “not found” would be a lie nothing explains. The
`deckForWrite` service loads the row by its identifier alone, then compares the
owner: 404 if it does not exist, 403 if it is not ours.

The guarantee lives **in the service**, never in the screen. Hiding the pencil is a
courtesy; what protects is the server's refusal, and it is tested route by route —
`PATCH`, `DELETE`, `PUT /cards`.

**Folders** keep the 404 in both directions, and it is not an oversight: a folder is
its owner's filing, it is not something to look at. Nothing will ever put it in
front of someone else, so “not found” stays true there.

**What is still missing, and cannot be written today.** The sheet's pencil must
disappear for non-owners. That would require the sheet to be able to display
someone else's deck — which no route allows yet. Writing an `isOwner` nothing can
make false right now would give an always-true condition, impossible to check with a
test: decoration. The day reading opens up, it is a field in the response and a
`when()` around the pencil; the server refusal is already there and will not have to
be revisited.

---

## ADR-010 — One content security policy, written once, served everywhere

**Context.** A policy is only as good as the version the browser actually receives,
and the usual failure is not a wrong directive: it is two copies drifting apart —
nginx serving one, the development server another, so the strict one is first met in
production, on the day it breaks a screen.

Until images were served by ATEM (ADR-003), no policy could be written at all:
`img-src` had to name `images.ygoprodeck.com`, and a policy with an outside host in
it protects far less than it appears to.

**Choice.** The policy lives in **one file**, `deploy/security-headers.conf`, with
every directive justified beside it. nginx `include`s it. Vite reads that same file
and serves it in development — so the end-to-end tests run under the real policy,
which is the only way a directive that is too narrow is found by a test rather than
by a person.

Development relaxes exactly one directive: `style-src` also accepts
`'unsafe-inline'`, because Vite injects the styles it hot-reloads as inline tags.
Nothing else is relaxed, and the relaxation is a single named line rather than a
second policy.

**Why these directives.** `default-src 'self'` and then only what the application
needs: `'wasm-unsafe-eval'` because Tesseract compiles WebAssembly and `blob:` for
the worker it spawns — `'unsafe-eval'` is **not** needed and is refused by name.
`frame-ancestors 'none'` and `object-src 'none'` because nothing here is ever framed
or embedded. `connect-src 'self'`: the API is same-origin, and the OCR runs in the
browser.

**What keeps it honest.** `scripts/check-csp.mjs`, in `check-all.sh`. It refuses
`'unsafe-inline'` on scripts and `'unsafe-eval'`; it requires the directives above to
say what they say; it reads `apps/web/src` and fails if the code loads a host the
policy does not allow, or carries a `style="…"` attribute the strict `style-src`
would silently refuse; and it checks that nginx, Vite and the web image all still
point at the one file. Each of those was verified by planting the fault and watching
the gate fail.

---

## ADR-011 — Registration says no, without saying why *(settled, do not reopen)*

**Context.** Refusing a registration with “that address is already in use” answers,
for anyone who asks, whether a given person has an account on this instance. Hiding
it completely is a solved problem — accept the registration, write nothing, and email
the address's owner that someone tried — but it needs SMTP, which ATEM does not have
and is not going to grow for this.

**Decision, by Ange on 2026-09-16.** The screen says “An account cannot be created
with this email address.” The server logs the real reason, with the address, for the
operator. We do **not** send email, and we do **not** pretend the registration
succeeded — a success that creates nothing would break the very next step, signing
in, and trade a disclosure for a lie.

**What this accepts, stated plainly.** Enumeration is narrowed, not closed: the
attempt still fails where it would have succeeded, and that difference is the answer.
What it costs an attacker is a registration attempt per address, under the register
ceiling — five an hour by default, per address and per caller — instead of a free
membership test.

**Why this is the right trade here.** ATEM is self-hosted, one instance per
community. The value of knowing that someone has an account on a friend's instance is
small; the cost of an SMTP dependency — configuration, deliverability, a queue, a
failure mode on every sign-up — is paid by every host, forever.

**This is settled.** It is a choice, not a gap: do not reopen it as a finding, and do
not "fix" it by making the refusal vaguer still. Revisit only if ATEM gains email for
another reason — then the mitigation above becomes free, and it becomes worth doing.
