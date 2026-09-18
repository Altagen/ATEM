# ATEM — Domain model (invariant core)

> **Status: validated on 2026-09-09, revised on 2026-09-16.** This document is frozen. Screens, filters and
> export formats stay open; the entities and relations below only change through an explicit, recorded decision.
> That is the guarantee we will not reproduce ATEM-old's drift. The 2026-09-16 revision is such a decision:
> every change is listed, with its reason, in the decision record at the end.

---

## Facts measured on the YGOPRODeck API (2026-09-09)

These figures come from real calls, not estimates. They justify the decisions.

| Measurement | Value |
|---|---|
| Cards (full EN dump, 1 request, 22 s) | **14,524** — 21 MB JSON |
| Cards (full FR dump) | **11,661** — 18 MB JSON |
| Cards with no FR version (→ EN fallback required) | **2,863** |
| Printings (`set_code`) in total | **44,517** |
| Artworks (illustration variants) | **14,688** |
| Distinct rarities | 48 |
| API limit | 20 req/s — exceeding it = 1 h IP ban |

### Real constraints

**C1 — Search by set code goes through `cardsetsinfo.php`.**
`cardsetsinfo.php?setcode=LOB-EN001` directly returns `{id, name, set_name,
set_code, set_rarity, set_price}`. It is the endpoint that resolves a printed code.
(`cardinfo.php` has no set code parameter — it only serves to fetch the full record
afterwards, by `id`.)

**C2 — Non-English set codes are not indexed.**
Measured: `LOB-EN001` and `PSV-E088` answer; `LOB-FR001` and `SDK-FR001` return
“No card matching your query”. The `language=fr` dump fixes nothing — checked on
“Magicien Sombre”: `name` and `desc` are translated, but `card_sets` contains
`CT13-EN003`, `DB1-EN102`… never `-FR`.

→ A French code is resolved by **switching the region to EN** for the query
(`LTGY-FR008` → `LTGY-EN008`), then **keeping the French code** as the printing's
identity on the user's side. That is exactly what ATEM-old does
(`toEnglishLookupSetCode`), and it is validated by use.

**C3 — The FR translation is partial.**
Only `name` and `desc` are localised. `type`, `race`, `attribute`, `frameType` stay
in English (`Spellcaster`, `DARK`, `Equip`). And **2,863 cards out of 14,524** have
no French version at all.
→ Enumeration labels and the EN fallback are **our** responsibility.

## Structural decisions

### D1 — `Card` and `CardPrint` are two distinct entities

It is **the** decision everything else depends on.

- **`Card`** = the card in the rules' sense, identified by its **passcode** (8 digits).
  Immutable, comes from the reference data. “Dark Magician” is ONE card.
- **`CardPrint`** = a **printing** of that card in a given set, identified by its
  **set code** (`LOB-FR001`) + its rarity. Dark Magician has **59 printings**.

Confusing the two makes impossible both valuing a collection (rarity and edition
change everything) and the 3-copy rule (which applies to the card, not the
printing). It is the classic mistake not to make again.

### D2 — A collection holds `CardPrint`s, not `Card`s

The user scans a set code: they declare owning **one precise printing**. The
“+1 / -1 next to a card” operates on `CollectionItem`, so on the printing.

### D3 — A deck references `Card`s, not `CardPrint`s

The 3-copy limit applies per card, all printings taken together. A deck is a list
of cards; the physical copy used does not matter to the rules.

The question “do I own the cards of this deck?” is computed by summing the
quantities of **all** printings of that card in the collection.

> Planned evolution without breakage: if one day we want to pin a precise printing
> to a deck entry (for the physical deck's looks), we add an optional allocation
> table. The current schema does not prevent it.

### D4 — Resolving a set code: switch to EN for the query, printed code for identity

**Context.** C2: only English codes are indexed by YGOPRODeck.

**Procedure** (taken from ATEM-old, proven):

```
1. Normalise         "ltgy fr008"  → "LTGY-FR008"   (uppercase, spaces → dash)
2. Infer the language "LTGY-FR008" → fr             (middle segment; default en)
3. Look up locally by the printed code, then by its EN equivalent
4. If absent: query cardsetsinfo.php with "LTGY-EN008"
5. Persist TWO printings: the player's (LTGY-FR008, fr)
                          and its EN counterpart (LTGY-EN008, en)
```

Step 5 is what lets the collection keep **the code really printed on the card** —
the one the player sees, scans and finds again at export — while staying connected
to the English reference data.

**Identity of a printing**: `(set_code, rarity, language)`. Rarity is part of it
because the same set code exists in several rarities.

Rarity **is not entered when adding**: it comes from the catalogue. A five-value
menu settled nothing — 10.1% of printings carry several rarities for the same code,
and 91% of those have at least one outside those five. The choice will come up when
editions can be recorded, with the code's real rarities.

### Known limit — the French wiki's suffixed codes do not resolve

The French wiki distinguishes the rarities of the same edition with a **letter
suffix**: `RA03-FR004` (Secret Rare), `RA03-FR004u` (Ultra), `RA03-FR004q`
(Quarter Century Secret), `RA03-FR004ul`, `RA03-FR004c`…

**That suffix is not printed on the card.** The card carries `RA03-FR004`, and that
is what the player scans or types. The convention belongs to the wiki.

A suffixed code entered as is **does not crash, but never resolves**: its canonical
form (`RA03-004UL`) matches no known printing, `cardsetsinfo.php` does not know it
either, and the resolution queue gives up — an absence is not an error, it is not
retried. The row enters the collection with the right quantity and stays there
**“awaiting identification” indefinitely**, with no name or artwork.

A fallback would be risk-free, and that is measured: out of **38,435 distinct
codes**, a single one ends with letters after its digits — `BLAR-EN10K`, whose base
`BLAR-EN10` does not exist. Retrying without the suffix only after the exact code
fails would therefore never touch a legitimate code.

**Ange's decision on 2026-09-10: we do not do it.** The case only comes up when
copying a code from the wiki instead of reading it on the card, which is not the
gesture the application serves. The limit is noted here so it is recognised if it
comes up, rather than diagnosed again.

### D5 — The reference data is read-only and replayable

The reference tables (`cards`, `card_prints`) are **never** written by a user
action. They are filled by an identified, idempotent command
(`pnpm --filter @atem/api catalogue:sync`) and by the resolution of scanned codes,
both going through `referential`'s write API — which makes a refresh replayable and
diagnosable. *(Revised on 2026-09-16 — see R6.)*

---

## Entities

As built. Where this differs from the 2026-09-09 version, the reason is in the decision
record (R1–R15).

### Reference data (immutable, source: YGOPRODeck)

```
cards
  passcode          PK, 8 digits            -- identity in the rules' sense
  name_en           -- always present, serves as fallback
  name_fr           nullable                -- R1: localisation as columns
  desc_en, desc_fr  nullable
  type, frame_type, race, attribute   -- raw EN values, translated in the UI (C3)
  atk, def, level, scale, link_value, link_markers   -- nullable depending on type
  archetype         nullable
  banlist_tcg       nullable                -- R2
  image_url, image_url_small          -- R5: the source; screens get /media (ADR-003)
  updated_at

card_prints
  id                PK
  card_passcode     nullable FK -> cards    -- null while unresolved (ADR-008)
  set_code                  -- "LOB-EN001", as printed
  canonical_set_code        -- "LOB-001", the local join key (ADR-007)
  set_name          nullable                -- R3: no set table
  rarity                    -- "" = not known yet
  language
  resolve_status            -- resolved | pending | unidentified (ADR-008)
  UNIQUE (set_code, rarity, language)
  CHECK  (resolve_status = 'resolved') = (card_passcode is not null)
```

### User

```
users
  id                PK, uuid
  email             UNIQUE (case-insensitive)
  password_hash             -- scrypt, versioned parameters
  display_name, tag         -- username + discriminator, UNIQUE together (R7)
  role                      -- member | admin
  locale                    -- fr | en
  token_version             -- bumped to revoke every issued session
  suspended_at      nullable
  created_at

auth_attempts               -- rate limiting, survives restarts
  bucket, action, attempted_at
```

> Visibility is **not** in the core any more: ADR-009 decided that, for this
> iteration, any session reads and only the owner writes (R8).

### Collection

```
owned_cards
  id                PK
  user_id           FK -> users, cascade
  print_id          FK -> card_prints       -- D2: the unit is the printing
  set_code                  -- what the player read, kept even if unresolved (R9)
  quantity                  -- 0..1000; 0 rows are kept and hidden (R9)
  is_favorite               -- per printing (R10)
  notes             nullable
  added_at, updated_at
  UNIQUE (user_id, print_id)

scanlists                   -- a batch inventoried outside the collection (R11)
  id, user_id, name, created_at
  poured_at         nullable                -- set once, by the pour itself

scanlist_lines
  scanlist_id, set_code, name, passcode     -- what was read, not a referential row
  quantity                  CHECK 1..1000
  UNIQUE (scanlist_id, set_code)
```

### Decks

```
deck_folders
  id, user_id, parent_id  nullable          -- tree, max depth 3, no cascade on parent_id
  name                      UNIQUE among siblings (nulls not distinct)
  created_at, updated_at

decks
  id, user_id, name         UNIQUE per user
  folder_id               nullable, on delete set null
  target_main             default 40, CHECK between 40 and 60   -- the size aimed at
  created_at, updated_at                    -- R12: cover derived, no description, no visibility

deck_cards                                  -- D3: references the card (R13)
  (deck_id, passcode)       UNIQUE
  main_qty, extra_qty, side_qty
  CHECK main_qty + extra_qty + side_qty between 0 and 3
```

### Planned, not built

```
Friendship, Block           -- M4, owned by `social` (R15)
ImportJob                   -- M3, owned by `data` (R15)
```

---

## Deferred — NOT to be implemented, but not to be made impossible

`Guild`, `GuildMember`, `GuildApplication`, `GuildActivityLog`, `Message`,
`Duel`, `DuelTurn`, `DamageEvent`, `Tournament`, `Trophy`.

**Compatibility constraints to respect right now:**

- `UserProfile` plans a future attachment to a guild → do not denormalise the
  username or membership into other tables.
- A duel will reference **two `Deck`s** → a deck must never be physically deleted
  once used; plan a soft delete. *(Decks are hard-deleted today, since nothing
  references them yet — see R14.)*
- Trophies will be attached to the profile → `UserProfile` stays extensible.

---

## Decision record — 2026-09-16

The model above was compared with the code, entity by entity. Each gap was settled one
way or the other — the document follows the code when the code carries a decision
taken since, the code must follow the document when the code is wrong. Decided by Ange,
who delegated the recommendation for each line.

| # | 2026-09-09 model | As built | Decision and reason |
|---|---|---|---|
| R1 | `CardLocalization (card_passcode, lang)` table | `name_fr`, `desc_fr` columns on `cards` | **Document follows.** Two languages only; a join less on every collection query. A table comes back with a third language. |
| R2 | `konami_id`, `banlist_ocg` | absent | **Document follows.** Nothing reads them (TCG only): declaring them would be dead columns. Added with the feature that reads them. |
| R3 | `CardSet (set_prefix, set_name, release_date, num_of_cards)` | `set_name` on `card_prints` | **Document follows.** No screen browses sets. The table comes with a set view. |
| R4 | `CardPrint`: `set_code_normalized`, `set_prefix`, `rarity_code`, `price_indicative`; non-null card | `canonical_set_code`; card nullable + `resolve_status` | **Document follows.** ADR-007 (two set code shapes) and ADR-008 (an unresolved printing has no card). No reader for the other columns. |
| R5 | `CardImage` with `local_path` — “a file served by ATEM, never a remote URL” | `image_url` holds YGOPRODeck's address; every screen is given `/media/cards/<passcode>.jpg`, served from disk | **Settled: conforming, 2026-09-16.** The remote URL is kept as the *source* rather than moved to a table of its own: a passcode identifies one artwork, so `local_path` would be that passcode written twice. An image is downloaded the first time someone asks for it — through the outbound token bucket, from an HTTPS allowlist of one host — then served from disk forever. Nothing is pre-fetched: pulling 14,524 artworks nobody looks at is the volume YGOPRODeck's guide warns about. No fallback to the remote URL: a missing image is missing, never a hot-link. That is what let the content security policy close the page (`check-csp.mjs`). |
| R6 | `ReferentialImport` job table | the idempotent `catalogue:sync` command | **Document follows.** A refresh is replayed by running the command again. A job table comes when refreshes are scheduled. |
| R7 | `User.status`; `UserProfile (display_name, tag, avatar, banner, bio)` | `suspended_at`, `role`, `token_version` on `users`; `display_name`/`tag` there too; no profile table | **Document follows.** Session revocation and suspension are what the identity module needs. Since 2026-09-17 `bio` (255) and `avatar` (one of five presets, checked by the database) sit on `users` too, with the profile screen; there is still no profile table, and no banner — nothing chooses one. |
| R8 | `visibility_profile/collection/decks`, “in the core right now” | absent | **Document follows ADR-009**, decided by Ange on 2026-09-11: no visibility setting in this iteration; the setting will sit on the read path, which is already the only place to filter. |
| R9 | `CollectionItem (user_id, card_print_id)` PK, `quantity > 0` | `owned_cards` with an id, the printed `set_code` copied, `notes`, `quantity` 0..1000 | **Document follows.** The printed code is the inventory's truth even when unresolved; notes are ATEM-old parity; a row at zero is kept so its note and favourite survive a re-purchase (tested). The bounds are checked inside the write's transaction, not by a `CHECK`: PostgreSQL evaluates a check on the row proposed for insertion, before `ON CONFLICT` turns it into an update, which breaks the race-free `quantity + delta` write — tried and measured. |
| R10 | Favourite at card or printing level: open question (roadmap) | per printing | **Settled: per printing.** It is where the star lives on screen, one row per edition. |
| R11 | `ScanListEntry (raw_set_code, card_print_id nullable)` | `scanlist_lines (set_code, name, passcode)`, `poured_at` | **Document follows.** A batch records what was read, independently of the reference data — pouring is what resolves. `poured_at` makes pouring a single, idempotent write. |
| R12 | `Deck.description`, `cover_card_passcode`, `visibility` | absent | **Document follows.** The cover is derived from the most played card (2026-09-12); the description field had no screen and was removed as dead surface (2026-09-13); visibility per R8. |
| R13 | `DeckEntry (deck_id, section, card_passcode)` PK, `quantity 1..3`, `position` | `deck_cards (deck_id, passcode)` with `main_qty`/`extra_qty`/`side_qty` | **Document follows.** One row per card is what makes the three-copy rule a database constraint across zones — ATEM-old's per-zone rows let a card total six. No `position`: display is sorted. |
| R14 | “a deck must never be physically deleted once used” | hard delete, and the duel **copies the deck's name** | **Document does not follow, deliberately (2026-09-18).** A duel keeps the deck's identifier (`on delete set null`) *and* its name at the time: “played with Blue-Eyes” stays true once the deck is gone. A soft delete would leave ghost decks in the deck screen, which is where people file, not where they read history. See `docs/ref-duels.md`. |
| R15 | `Friendship`, `Block`, `ImportJob` | absent | **Planned** — M4 and M3, as the roadmap says. Not gaps. |
