# Reference — duels

*Written on 2026-09-18, before any code. Duels are the one feature with no
ancestor: ATEM-old never had them, and the design does not draw them. Everything
else in this project is transcribed from something that worked; this is decided.*

## What a duel is here

**ATEM records a duel played in person. It does not referee one.** Two people sit
down with their cards, and the application is the notebook beside the mat: who
played whom, with which deck, who won, and — if they want it — what happened turn
by turn.

That single sentence settles most questions. No rules engine, no card effects, no
legality checking during play, no timer. A duel row is a **testimony**, not a
game state, and the application never knows more about the game than the two
players tell it.

## Who can duel

**Friends only**, for this iteration. A duel is an agreement between two people
who know each other; opening it to anyone on the instance would make the
invitation a way to reach strangers, which is what blocking exists to stop.

The check goes through `social`'s single checkpoint (R3), like every other
question about what two people may do together.

## The life of a duel

```
proposed ──accept──▶ open ──finish──▶ recorded
    │                  │
  decline            cancel
    │                  │
    ▼                  ▼
  (row deleted)     (row deleted)
```

- **proposed** — one of the two invites the other, with a date (today by default).
  A line lands in the invited player's inbox. A refusal deletes the row, as a
  refused friend request does: there is nothing to keep, and a refusal left in
  place is an invitation that can never be sent again.
- **open** — accepted. Both may now write turns, and either may record the
  result.
- **recorded** — the result is in. The duel becomes read-only for both, and
  counts in what each player has played.

**Cancelling** is possible while `open` and only by the two participants — a duel
that did not happen leaves no trace. Once `recorded`, it stays: a history one can
rewrite is not a history.

## What a duel holds

| | |
|---|---|
| the two players | host and guest, both real accounts |
| the date played | chosen, not the row's creation time: one records the duel in the evening |
| each player's deck | optional, chosen among one's own decks |
| the score | wins per player, `2–1` and the like — the format is not policed |
| the winner | derived from the score; equal scores are a draw |
| a note | free text, bounded, for what the score does not say |
| the turns | optional, see below |

**The deck is recorded by name as well as by identifier.** The identifier keeps
the link while the deck exists; the name is copied into the duel when it is
recorded, so the history still reads after a deck is deleted — “played with
Blue-Eyes” stays true even when that deck is gone.

> This replaces what `docs/01-domain-model.md` (R14) reserved: “a deck must never
> be physically deleted once used”. A soft delete would leave ghost decks in the
> deck screen, which is where people file, not where they read history. Copying
> the name costs one column and keeps both screens honest.

## The turn-by-turn history

Optional, and **written during or after the duel by either player**. One turn
holds: its number, whose turn it was, both life totals after it, and a short
note (“Raigeki, then attacked with Blue-Eyes”).

Rules that matter:

- **Turns are append-only while the duel is open**, and frozen once recorded.
  Correcting the last one is allowed (a mistyped life total is common); rewriting
  turn 3 after turn 12 is not.
- **Both players write into the same history.** Each turn carries who wrote it,
  so a disagreement is visible rather than silently overwritten.
- **Life totals are bounded** but not checked against the rules: someone may play
  a format where they start at 16000, and the application is not the referee.

## What is deliberately not here

- **No live synchronisation.** ADR-006 stands: request/response only. Two phones
  around one mat both write to the same duel, and each sees the other's turns on
  its next read. A permanent connection for a pastime measured in minutes is not
  worth the infrastructure.
- **No ranking, no ladder, no rating.** ATEM-old displayed a rank that rested on
  nothing; the counted duels are the count, and that is all.
- **No spectators.** A duel is visible to its two players. Whether it appears on
  a public profile is a visibility question, and visibility has no setting yet.
- **No tournaments.** They are a structure over duels, and there is no structure
  until duels themselves are lived with.

## Refusals

| Situation | Answer |
|---|---|
| inviting someone who is not a friend | 404 — the same answer as for someone who does not exist |
| inviting yourself | 400 |
| accepting an invitation that is not yours | 404 |
| writing a turn on a duel one is not in | 404 |
| writing on a `recorded` duel | 409 |
| recording a result twice | 409 |

The read/write split of ADR-009 holds: a duel is read by its two players, and
every write takes the session's identity, never the path's.
