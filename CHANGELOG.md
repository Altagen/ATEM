# Changelog

All notable changes, by version. The format follows
[Keep a Changelog](https://keepachangelog.com), and versions follow
[semantic versioning](https://semver.org).

## [Unreleased] — 0.1.0

The first release.

### Collection
- Cards added by their printed set code — typed, or scanned with the phone's
  camera by on-device OCR — and identified against the YGOPRODeck catalogue.
- Filters on every property of a card; favourites; a note per copy.
- Scanlists: inventory a batch, then add it to the collection or discard it.
- CSV import and export in the ATEM, ScanFlip and Cardmarket formats.

### Decks
- Decks built from the collection, within the banlist and the zone limits,
  with a target Main Deck size; folders to file them.

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
