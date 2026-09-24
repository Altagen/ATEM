# Changelog

All notable changes, by version, following [semantic versioning](https://semver.org).

## [0.1.1](https://github.com/Altagen/ATEM/compare/0.1.0...0.1.1) (2026-09-24)


**0.1.0 could not be installed on a Debian or Ubuntu host.** Three defects, each
found by running the released images on a server: the database container started
and logged nothing while PostgreSQL never ran; the API exited with
`RangeError: Invalid array length` when `ATEM_DB_POOL` was not a clean number;
and `ATEM_TRUSTED_PROXIES` arrived as literal text, so every visitor shared one
rate-limit bucket. Upgrading is enough — no schema change.

### Bug fixes

* **api:** a setting that cannot be read falls back instead of killing the API ([da50b6e](https://github.com/Altagen/ATEM/commit/da50b6eba77ac283e542da6ab0e61d9483145453))
* **deploy:** let the database start on an AppArmor host ([9aacaea](https://github.com/Altagen/ATEM/commit/9aacaea36d7e9806b83ae1b651170b370bfeca1c))
* **deploy:** spell out the tunables, and ship the systemd units ([1b86a51](https://github.com/Altagen/ATEM/commit/1b86a514dc52fabc3298903b2878c50cef9cfca0))


### Documentation

* **deferred:** keep the idea of syncing the catalogue from the console ([40675e4](https://github.com/Altagen/ATEM/commit/40675e467f9bdef0b4be2f8556958ffbade237f5))

## 0.1.0 (2026-09-22)

The first release.

### Collection
- Cards added by their printed set code — typed, or scanned with the phone's
  camera by on-device OCR — and identified against the YGOPRODeck catalogue.
- Filters on every property of a card; favourites; a note per copy.
- Scanlists: inventory a batch, then add it to the collection or discard it.
- CSV import and export in the ATEM, ScanFlip and Cardmarket formats.

### Decks
- Decks built from the collection, within the banlist; folders to file them.
- A target Main Deck size (40 to 60): the counter counts towards it, and a
  deck past its size — Main above its target, Extra or Side above 15 — says
  how many cards are too many instead of refusing them.

### Community
- A directory of the instance's duellists, with presence.
- Friends, friend requests, blocking; an inbox.
- Profiles; each duellist chooses who may see their collection and their decks
  — everyone, friends, or only themselves.

### Duels
- A friend is invited, each picks a deck, the server flips the coin; the
  phases, turns and life points are followed from both phones; the winner is
  recorded, and past duels are kept.

### Administration
- One administrator, declared in the configuration.
- Registration open or closed; accounts created with a password their owner
  replaces at first sign-in; suspension, restore, deletion; a log of the
  administrator's actions.

### Running it
- Published images on GHCR, one `compose.yaml`, and a configuration that
  refuses to start incomplete.
