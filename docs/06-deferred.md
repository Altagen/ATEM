# Deferred — what is paused, and the ideas worth keeping

*Written on 2026-09-22, before the first release.* ATEM was rebuilt from an
earlier prototype. The prototype is gone from the project; what it got right is
already in the code, and what it had that ATEM does not do yet is here — with
screenshots of its screens in [`deferred/screens/`](deferred/screens/), so that
nothing has to be remembered.

**The rule that goes with this list:** nothing here is picked up in passing. An
item comes back when it is scoped as a milestone of its own, in
`03-roadmap.md`, and it is scoped against `00-vision.md` — some of the ideas
below would need that document changed first, and they say so.

---

## Guilds

**Screens:** `guild-*.jpg`, `community-guilds-*.jpg`.

The organiser persona's first need, and the prerequisite for tournaments.

- **One guild per duellist**, at most. A guild holds **50 members** at most.
- **Three roles.** One **owner**, with every right. **Managers**, appointed by
  the owner, whose rights the owner chooses (invite, exclude). **Members**.
- **Three ways in.** *Open*: anyone without a guild joins at once. *On
  application*: a message, waiting in the officers' shared inbox. *On
  invitation only*: applications closed, the owner or an allowed manager
  invites.
- **Applying to several guilds at once is allowed.** The first acceptance
  wins: every other pending application of that duellist is cancelled
  automatically, and officers elsewhere see it as no longer relevant.
- **Two officers accepting the same person at the same moment** must not make
  them a member twice: the acceptance locks the duellist's row, checks they are
  still without a guild and that the guild is not full, all in one
  transaction.
- **Dissolving a guild** asks for its exact name to be typed, then leaves five
  seconds to undo — the same shape as the collection's erase.
- **Excluding a member** can carry a reason. **A guild announcement** reaches
  every member's inbox.
- **An activity log** per guild: who joined, left, was promoted, excluded — the
  guild's history, readable by its members.
- **Where it shows:** a guild tab in the community directory, a guild strip on
  the profile, the guild's tag beside a duellist's name.

Needs, before code: the inbox already carries events and actors; guilds add
their own kinds. The access checkpoint (`canView`) gains a “same guild”
answer if a visibility ever depends on it.

## Tournaments

Not designed in the prototype beyond a banner announcing one. They are a
structure over duels **and** guilds, so they come after both. Nothing to keep
but the order.

## Administration, beyond the 0.1.0 console

**Screens:** `admin-*.jpg`.

The 0.1.0 console has the players' count, registration open or closed,
accounts (create, suspend, restore, delete) and the administrator's log. The
prototype had more, and these are the parts worth having one day:

- **Registration on invitation code.** A third registration mode besides open
  and closed: codes with a label, a usage limit (or none) and an expiry date,
  each showing who registered with it. Deferred on 2026-09-21 as not needed yet.
- **Announcements.** A message sent to every inbox, with a category (general,
  event, maintenance, urgent), and a **banner** at the top of every page —
  themed, dismissable or not (a maintenance notice should not be closable).
- **A log of the players' activity.** Deliberately left out of the console:
  the server's own logs hold it, and a pipe to ship them elsewhere is the
  right tool when someone needs it.
- **The catalogue cache setting.** Keep every downloaded artwork, or drop an
  artwork once nobody owns or plays its card — with the disk space shown.
  Today every artwork is kept, and the disk reserve protects the database.
- **An administrator acting inside a guild** (the prototype's “admin
  override”), once guilds exist — and logged like every other administrator
  action.
- **A direct message** from the administrator to one player, landing in their
  inbox — the announcement's single-recipient form.

## Inbox

- **Archiving** a message instead of deleting it, with an archive to read
  back later.
- **Clearing every read message** in one gesture. Today a message is deleted
  one at a time, and everything is marked read at once.

## The landing page

**Screens:** `landing-*.jpg`.

A visitor today lands on the sign-in page. The prototype had a landing page: the
name, one sentence (“manage your Yu-Gi-Oh! collection, scan your cards by OCR,
build your decks from what you really own”), sign-in and sign-up buttons, a card
that turns in 3D under the pointer, and three short feature cards — personal
collection with a shared artwork cache, OCR acquisition, assisted deck-building.
Worth having for an instance open to strangers; not needed for a group of
friends.

## Settings

**Screens:** `settings-*.jpg`.

- **Interface preferences**: the prototype had a card inspection mode (how a
  card opens — side panel or full screen). ATEM opens one way today.
- **Not kept, on purpose:** the account's internal identifier with a copy
  button (no use to the person reading it), and a “configuration” entry for
  administrators inside the settings — the administrator has its own console.

## Collection, decks and scanning

- **Banlist enforcement per deck** — choosing, deck by deck, whether the
  banlist limits apply (a casual deck may ignore them). The one functional gap
  the prototype had listed itself.
- **Reading the banlist itself** — a panel listing the forbidden, limited and
  semi-limited cards the workshop applies. Today each card shows its own
  status, and the list as a whole is not shown.
- **Foil and holographic cards**: glare makes the set code hard to read. A
  pre-processing step that removes specular highlights before the OCR.
- **Installable application** (PWA): a manifest, a service worker, the static
  assets cached for a scan in a shop with a poor connection.
- **A vision-model fallback** when the OCR's confidence is low — *needs
  `00-vision.md` changed first*: it would send card photos to an outside
  service, which the instance does not do today.

## A deck analysis engine

The prototype's most ambitious document: cards described by what they do
(starters, extenders, searchers, disruptions, locks…) rather than by their
text, the consistency of a deck computed with the hypergeometric law, and
several proposed builds — most consistent, highest ceiling, balanced — from
what one owns. *Needs `00-vision.md` read closely first*: it does not simulate
a duel, so it is not excluded by the first non-goal, but tagging fourteen
thousand cards by function is a data project of its own, and the vision says
ATEM does not complete the reference data by hand.

## Rejected — so that nobody proposes them again

- **Ranks, trophies and titles** on profiles and in the directory (“Master”,
  “Champion of the Grand Prix”, “Level 100”). The prototype derived them from
  nothing — from the role, or invented them. A profile shows what is counted:
  duels played and won.
- **Favourite decks on the profile.** A profile is not a shelf; the decks are
  one click away, as their owner chooses to show them.
- **A score per duel.** A duel has a winner (`ref-duels.md`).
- **A live connection** (the prototype's server-sent events). Polling every
  few seconds answers every question the screens ask — ADR-006.
- **An onboarding step** to choose one's display name after signing up: ATEM
  asks for it on the sign-up form, and the number after it (`#0042`) removes
  the need to check availability.
- **Uploaded avatars**: the picture is one of the product's presets, never an
  upload — the prototype had already removed its own.
- **Several administrators**, or promoting a player: there is one, and the
  configuration names it.

## The screenshots

| Screen | Files |
|---|---|
| Landing page | `landing-desktop.jpg`, `landing-mobile.jpg` |
| Sign-in, sign-up, first password | `login-*`, `register-*`, `password-change-*` |
| Collection, scanlist, decks | `collection-*`, `scanlist-*`, `decks-*` |
| Community — directory and guilds | `community-*`, `community-guilds-*` |
| A guild — members, recruitment, log | `guild-*`, `guild-recruitment-*`, `guild-logs-*` |
| Profile | `profile-*` |
| Settings | `settings-*` |
| Administration — overview, announcements, accounts, invitation codes, log, configuration | `admin-*`, `admin-broadcast-*`, `admin-users-*`, `admin-invites-*`, `admin-audit-*`, `admin-config-*` |

They show the prototype's mock-up with its demonstration data, in French; the
names in them are invented.
