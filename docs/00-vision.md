# ATEM — Vision & scope

## In one sentence

ATEM is a self-hostable web service that gives paper Yu-Gi-Oh! players a digital
inventory of their collection, a deck-building workshop, and an in-person duel
assistant — without ever simulating the game's rules.

## What it is NOT (non-goals)

These exclusions are structural. Any future request contradicting them is a change
of scope, not an evolution.

1. **Not a game simulator.** No resolution of effects, chains, timing or move
   legality. Faithful reproductions already exist (EDOPro, Master Duel).
2. **No tracking of cards played in a duel.** The assistant records game metadata
   (turns, phases, damage, winner), never the card-by-card course of play.
3. **Not a marketplace.** No transaction, no sale, no trade. Any prices displayed
   are indicative and come from the reference data.
4. **No card image recognition.** The OCR reads the **printed set code**, not the
   artwork.
5. **Not a source of truth about cards.** The reference data belongs to
   YGOPRODeck. ATEM hosts a mirror of it, does not correct it and does not
   complete it by hand.

## Positioning

The service improves the **atmosphere of in-person play**. It does not replace the
game, it accompanies it: you play with your real cards on a real table, ATEM keeps
the score and the memory.

## Personas

| Persona | Main need | Priority |
|---|---|---|
| **The collector** | Inventory a large volume of physical cards quickly, find what they own | P0 |
| **The deckbuilder** | Build decks from what they really own | P0 |
| **The duellist** | Look at other players' profiles/decks, start a duel | P0 |
| **The organiser** | Run a community, guilds, tournaments | Deferred |
| **The host** | Deploy and administer the instance | Deferred |

## Chosen priority order

**Now** — Collection · Decks · User settings · Duellists (social directory) ·
Viewing other players' profiles/decks/collections.

**Deferred, scoped later** — Duel mechanics · Tournaments · Guilds · Inbox ·
Administration area · Advanced profile customisation.

The technical core (see `01-domain-model.md` and `02-architecture.md`) must make
these deferred elements *possible without a rewrite*, without implementing them
today.

## Deployment model

One instance = **one community**. No multi-tenancy. The first intended use is
personal or small-group; the community side is added to the same data model with
no extra partitioning.
