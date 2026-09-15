# ATEM — Domain model (invariant core)

> **Status: validated on 2026-09-09.** This document is frozen. Screens, filters and export formats stay open;
> the entities and relations below only change through an explicit, recorded decision.
> That is the guarantee we will not reproduce ATEM-old's drift.

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

### D5 — The reference data is read-only and versioned

The reference tables (`Card`, `CardPrint`, `CardSet`, `CardImage`,
`CardLocalization`) are **never** written by a user action. They are filled by an
identified import job (`ReferentialImport`), which makes a refresh replayable and
diagnosable.

---

## Entities

### Reference data (immutable, source: YGOPRODeck)

```
Card
  passcode          PK, 8 digits            -- identity in the rules' sense
  konami_id         nullable
  name_en           -- always present, serves as fallback
  desc_en
  type, frame_type, race, attribute   -- raw EN values, translated in the UI (C3)
  atk, def, level, scale, link_value, link_markers   -- nullable depending on type
  archetype         nullable
  banlist_tcg, banlist_ocg           nullable

CardLocalization                       -- 11,661 rows in FR (C3)
  (card_passcode, lang)  PK
  name, desc

CardSet
  set_prefix        PK      -- "LOB"
  set_name                  -- "Legend of Blue Eyes White Dragon"
  release_date, num_of_cards

CardPrint                              -- 44,517 rows
  id                PK
  card_passcode     FK -> Card
  set_code                  -- "LOB-EN001", as printed
  set_code_normalized       -- "LOB-001", UNIQUE-ISH INDEX, see D4
  set_prefix        FK -> CardSet
  rarity, rarity_code
  price_indicative  nullable

CardImage                              -- 14,688 rows
  image_id          PK      -- != passcode for alternative artworks
  card_passcode     FK -> Card
  variant                   -- full | small | cropped
  local_path                -- file served by ATEM, never a remote URL
```

### User

```
User
  id                PK, uuid
  email             UNIQUE
  password_hash             -- scrypt
  locale                    -- fr | en
  status, created_at

UserProfile
  user_id           PK, FK -> User
  display_name, tag         -- username + discriminator
  avatar, banner, bio
  visibility_profile        -- public | friends | private
  visibility_collection     -- same
  visibility_decks          -- same
```

> Visibility is in the core **right now**, while social is P0 but light. Adding
> privacy rules afterwards on already written endpoints is a classic source of data
> leaks.

### Collection

```
CollectionItem
  (user_id, card_print_id)  PK          -- D2: the unit is the printing
  quantity                  > 0
  is_favorite
  added_at, updated_at

ScanList                                -- P1, batch of scans outside the collection
  id, user_id, name, created_at
ScanListEntry
  scan_list_id, raw_set_code
  card_print_id             nullable    -- null = unresolved, to fix by hand
  quantity
```

### Decks

```
DeckFolder
  id, user_id, parent_id  nullable      -- tree
  name

Deck
  id, user_id, folder_id  nullable
  name, description
  cover_card_passcode     nullable
  visibility                            -- public | friends | private
  created_at, updated_at

DeckEntry
  (deck_id, section, card_passcode)  PK -- D3: references the card
  section                               -- MAIN | EXTRA | SIDE
  quantity                  1..3
  position                              -- display order
```

### Social (light P0)

```
Friendship
  (requester_id, addressee_id)  PK
  status                                -- pending | accepted
  created_at, responded_at

Block
  (blocker_id, blocked_id)  PK
```

### Data & compliance

```
ImportJob
  id, user_id, source                   -- atem | scanflip | cardmarket
  mode                                  -- merge | replace
  status, rows_total, rows_ok, rows_failed
  report            -- failed rows, viewable (“Import history”)
  created_at
```

---

## Deferred — NOT to be implemented, but not to be made impossible

`Guild`, `GuildMember`, `GuildApplication`, `GuildActivityLog`, `Message`,
`Duel`, `DuelTurn`, `DamageEvent`, `Tournament`, `Trophy`.

**Compatibility constraints to respect right now:**

- `UserProfile` plans a future attachment to a guild → do not denormalise the
  username or membership into other tables.
- A duel will reference **two `Deck`s** → a deck must never be physically deleted
  once used; plan a soft delete.
- Trophies will be attached to the profile → `UserProfile` stays extensible.
