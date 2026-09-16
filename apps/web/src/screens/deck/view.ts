/**
 * The decks markup — the list and the workshop.
 *
 * **Transcribed from ATEM-old**, whose interface had been validated:
 * `decks/vue.ts`, `vue-atelier.ts` and `vue-pieces.ts`, with the classes of
 * `styles/pages/decks.css`. What is not taken is not left out by oversight but
 * for want of anything to wire it to — folders, the deck options modal and the
 * banlist table have no server support here, and a control that does nothing is
 * worse than no control.
 *
 * The collection panel uses the **same classes as the Collection screen** —
 * `.item`, `.item-row`, `.item-main`, `.thumb` — and that is intended: you draw
 * from the same thing, it must read the same.
 */
import {
  DECK_ZONE_LIMITS, DECK_ZONES, checkDeckAdd, deckStatus, isExtraDeckCard,
  parseBanlistStatus, type BanlistStatus, type DeckZone,
} from "@atem/shared";
import { t } from "../../platform/i18n/index.js";
import { cardSheetHtml } from "../shared/card-sheet.js";
import { translateAttribute } from "../../platform/ygo-labels.js";
import { html, raw, when, type SafeHtml } from "../../platform/ui.js";
import {
  breadcrumbHtml, childFolders, deckFolderPath, deckMenu, decksIn, folderRow,
  folderTile, modalHtml, moveBannerHtml, parentRow, parentTile, searchDecks,
} from "./folders.js";
import {
  inDeck, type CollectionRow, type DeckDetail, type DeckState, type DeckSummary,
} from "./state.js";

/** The attributes, in the order the mock-up files them. */
const ATTRS = ["DARK", "LIGHT", "EARTH", "WATER", "FIRE", "WIND", "DIVINE"];

/**
 * The banlist labels — translated at display time, not at declaration.
 *
 * This table is evaluated at import, before the account's language is known.
 */
const BAN_LABELS: Record<BanlistStatus, string> = {
  forbidden: "Forbidden",
  limited: "Limited to 1",
  semi_limited: "Limited to 2",
  unlimited: "",
};

const KIND_LABELS: Record<string, string> = {
  "": "All",
  monster: "Monster",
  spell: "Spell",
  trap: "Trap",
  extra: "Extra",
  fav: "★",
};

/* ── The pieces ────────────────────────────────────────────────────────── */

/**
 * The zone icons, taken as they were.
 *
 * Main: a stack. Extra: a star. Side: layers. They tell the three tabs apart
 * without reading them, which counts when you come back a hundred times.
 */
function zoneIcon(zone: DeckZone): SafeHtml {
  // The shapes are markup, so they are marked trusted **as literals** — written
  // here, never assembled from a value. The `<svg>` around them then goes
  // through `html` like everything else, which escapes `zone`.
  const paths: Record<DeckZone, SafeHtml> = {
    main: raw(`<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h6M9 11h6M9 15h4"/>`),
    extra: raw(`<path d="M12 2l4 8 8 1-6 5 2 8-8-4-8 4 2-8-6-5 8-1z"/>`),
    side: raw(`<path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 12l10 5 10-5"/><path d="M2 17l10 5 10-5"/>`),
  };
  return html`<svg class="zone-ico zone-ico-${zone}" viewBox="0 0 24 24" width="14" height="14"
    aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2">${paths[zone]}</svg>`;
}

/** The banlist pill — nothing at all when the card is unlimited. */
function banBadge(banlistTcg: string | null | undefined): SafeHtml {
  const status = parseBanlistStatus(banlistTcg);
  if (status === "unlimited") return raw("");
  const cls =
    status === "forbidden" ? "ban-badge-forbidden"
    : status === "limited" ? "ban-badge-limited"
    : "ban-badge-semi";
  return html`<span class="ban-badge ${cls}"
    >${when(status === "forbidden", raw(`<span class="ban-slash"></span>`))}${t(
      BAN_LABELS[status],
    )}</span
  >`;
}

const thumbnail = (url: string | null | undefined, cls = "thumb"): SafeHtml =>
  url
    ? html`<img loading="lazy" decoding="async" class="${cls}" src="${url}" alt="" />`
    // `html`, not `raw`: the class is interpolated, so it goes through the
    // escaping like any other value. Nothing here needs to be trusted.
    : html`<div class="thumb-empty ${cls === "thumb" ? "" : cls}">?</div>`;

/**
 * The zone counter, with its limits.
 *
 * It is the only thing you look at while building: how many are missing, and
 * whether you have gone over. `count-full` says “it is full” without shouting;
 * `count-over` shouts, because a deck above the limit is unplayable.
 */
function countsBar(deck: DeckDetail, state: DeckState): SafeHtml {
  return html`<p class="meta-line deck-counts">
    ${DECK_ZONES.map((zone) => {
      const { max } = DECK_ZONE_LIMITS[zone];
      /**
       * The denominator is the **rules' ceiling**, not the target: it answers
       * “how many more may I legally put in?”, which does not depend on what
       * this deck is aiming for. The target decides the shortfall colour only,
       * and only in the Main — the other two zones have no floor to fall short
       * of.
       */
      const floor = zone === "main" ? deck.targetMain : DECK_ZONE_LIMITS[zone].min;
      const n = deck.counts[zone];
      const cls = n > max ? "count-over" : n >= max ? "count-full" : n < floor ? "count-short" : "";
      return html`<span class="${cls}"
        >${zoneIcon(zone)} ${ZONE_LABELS[zone]} <strong>${n}</strong>/${max}</span
      >`;
    })}
    ${when(
      state.savedAt !== null,
      html`<span class="deck-saved">${t("Saved")}</span>`,
    )}
  </p>`;
}

const ZONE_LABELS: Record<DeckZone, string> = { main: "Main", extra: "Extra", side: "Side" };

/**
 * Where the deck stands, in one sentence.
 *
 * Ange: “we are at 4/60, could we say ‘Deck incomplete’ or something like
 * that?”. `Main 4/60` is a number: you have to know the forty-card rule to know
 * whether it is good. The sentence says what is left to do, in cards, so that
 * nobody has to subtract in their head.
 *
 * **One sentence at a time** — the verdict comes from `deckStatus`, in
 * `@atem/shared`, which orders the states by severity. The same function
 * dresses the list's pill: two screens, one judgement.
 */
function deckStatusHtml(deck: DeckDetail): SafeHtml {
  const status = deckStatus(deck.counts, deck.missing, deck.targetMain);
  switch (status.kind) {
    case "over":
      return html`<p class="deck-status deck-status-over">
        ⚠
        ${t("Too many cards: remove {n} from the {zone}.", {
          n: status.excess,
          zone: ZONE_LABELS[status.zone],
        })}
      </p>`;
    case "missing":
      // It does not happen while building — the “+” refuses — but it does
      // happen when a card is later removed from the collection.
      return html`<p class="deck-status deck-status-over">
        ⚠ ${t("{n} to find: the deck holds more than your collection.", {
          n: status.missing,
        })}
      </p>`;
    case "empty":
      return html`<p class="deck-status deck-status-short">
        ${t("Empty deck — add your first cards from your collection.")}
      </p>`;
    case "short":
      // “aiming for”, not “minimum”: 40 is the rules' floor, but a deck aimed
      // at 60 is unfinished at 45 — and that number is the player's, not ours.
      return html`<p class="deck-status deck-status-short">
        ${t("Deck incomplete: {n} more in the Main (aiming for {target}).", {
          n: status.missing,
          target: status.target,
        })}
      </p>`;
    case "ready":
      return html`<p class="deck-status deck-status-ready">✓ ${t("Deck ready to play.")}</p>`;
  }
}

/**
 * A card's stepper: “−1 ×n +1”.
 *
 * The same object in the list and in the gallery, where it sits over the
 * artwork rather than under the thumbnail — the grid stays aligned.
 */
function stepper(row: CollectionRow, state: DeckState, compact = false): SafeHtml {
  const passcode = row.card?.passcode ?? 0;
  const already = inDeck(passcode);
  const issue = checkDeckAdd({
    banlistTcg: row.card?.banlistTcg,
    owned: state.owned.get(passcode) ?? 0,
    inDeck: already,
  });
  const refusal = issue.blockedBy ? REFUSAL_LABELS[issue.blockedBy] : null;

  return html`<div class="${compact ? "deck-stepper deck-stepper-overlay" : "deck-stepper item-actions"}"
    role="group" aria-label="${t("Quantity in the deck")}">
    <button type="button" class="btn-qty js-coll" data-pc="${String(passcode)}" data-d="-1"
            aria-label="${t("Remove a copy")}"
            ${already > 0 ? raw("") : raw("disabled")}>${compact ? "−" : "−1"}</button>
    <span class="deck-stepper-qty${already > 0 ? " is-in-deck" : ""}">×${already}</span>
    <button type="button" class="btn-qty js-coll" data-pc="${String(passcode)}" data-d="1"
            aria-label="${t("Add a copy")}"
            title="${refusal ? t(refusal) : t("Add to deck")}"
            ${issue.canAdd ? raw("") : raw("disabled")}>${compact ? "+" : "+1"}</button>
  </div>`;
}

/* ── The collection panel ──────────────────────────────────────────────── */

function collRow(row: CollectionRow, state: DeckState): SafeHtml {
  const card = row.card;
  const passcode = card?.passcode ?? 0;
  const already = inDeck(passcode);
  const forbidden = parseBanlistStatus(card?.banlistTcg) === "forbidden";

  return html`<li class="item${forbidden ? " card-ban-forbidden" : ""}${already > 0 ? " in-deck-selected" : ""}">
    <div class="item-row">
      <button type="button" class="item-main js-open-card" data-pc="${String(passcode)}">
        ${thumbnail(card?.imageUrlSmall ?? card?.imageUrl)}
        <div class="item-text">
          <strong>${card?.name ?? t("Unidentified card")}</strong>
          <code>${row.setCode}</code>
          <div class="item-meta">
            <span>${t("×{n} owned", { n: state.owned.get(passcode) ?? 0 })}</span>
            ${when(row.isFavorite, raw(`<span class="ok-tag fav-tag">★</span>`))}
            ${banBadge(card?.banlistTcg)}
          </div>
        </div>
        ${when(already > 0, html`<span class="in-deck-qty" aria-label="${t("In the deck")}">×${already}</span>`)}
      </button>
      ${stepper(row, state)}
    </div>
  </li>`;
}

function collTile(row: CollectionRow, state: DeckState): SafeHtml {
  const card = row.card;
  const passcode = card?.passcode ?? 0;
  const already = inDeck(passcode);

  return html`<div class="tile deck-coll-tile${already > 0 ? " in-deck-selected" : ""}">
    <div class="tile-art-wrap">
      <button type="button" class="tile-open js-open-card" data-pc="${String(passcode)}">
      <div class="tile-art">
        ${card?.imageUrlSmall || card?.imageUrl
          ? html`<img loading="lazy" decoding="async" src="${card.imageUrlSmall ?? card.imageUrl!}" alt="" />`
          : raw(`<div class="tile-art-empty">?</div>`)}
        ${already > 0
          ? html`<span class="in-deck-qty">×${already}</span>`
          : html`<span class="tile-qty muted-own">×${state.owned.get(passcode) ?? 0}</span>`}
      </div>
      </button>
      ${stepper(row, state, true)}
    </div>
    <button type="button" class="tile-body tile-open js-open-card" data-pc="${String(passcode)}">
      <strong class="tile-name">${card?.name ?? t("Unidentified card")}</strong>
      <code>${row.setCode}</code>${banBadge(card?.banlistTcg)}
    </button>
  </div>`;
}

function collectionPanel(state: DeckState): SafeHtml {
  const rows = visibleCollection(state);

  return html`<section class="deck-edit-collection">
    <div class="decks-toolbar">
      <label class="search">
        <span class="search-icon" aria-hidden="true">⌕</span>
        <input type="search" id="coll-search" value="${state.query}"
               placeholder="${t("Name, set code or #passcode…")}"
               aria-label="${t("Search your collection")}" />
      </label>
      <div class="view-toggle" role="group" aria-label="${t("Display")}">
        <button type="button" class="icon-btn${state.collView === "list" ? " is-active" : ""}"
                data-coll-view="list" title="${t("List")}" aria-label="${t("List view")}"
                aria-pressed="${String(state.collView === "list")}"><span class="i-list" aria-hidden="true"></span></button>
        <button type="button" class="icon-btn${state.collView === "gallery" ? " is-active" : ""}"
                data-coll-view="gallery" title="${t("Gallery")}" aria-label="${t("Gallery view")}"
                aria-pressed="${String(state.collView === "gallery")}"><span class="i-grid" aria-hidden="true"></span></button>
      </div>
    </div>

    <div class="chip-row">
      ${Object.keys(KIND_LABELS).map(
        (kind) => html`<button type="button"
          class="chip${state.kind === kind ? " is-active" : ""}" data-filter-kind="${kind}"
          >${t(KIND_LABELS[kind] ?? kind)}</button
        >`,
      )}
    </div>

    <div class="chip-row">
      ${ATTRS.map(
        (attr) => html`<button type="button"
          class="chip chip-attr${state.attributes.includes(attr) ? " is-active" : ""}"
          data-filter-attr="${attr}"
          ><img loading="lazy" decoding="async" src="/assets/icons/attr/${attr}.png"
                width="16" height="16" alt="" />${translateAttribute(attr)}</button
        >`,
      )}
    </div>

    ${rows.length === 0
      ? html`<p class="muted">${t("No cards (collection or filters).")}</p>`
      : state.collView === "gallery"
        ? html`<div class="gallery deck-edit-gallery" data-cols="6">
            ${rows.map((row) => collTile(row, state))}
          </div>`
        : html`<ul class="item-list deck-edit-coll-list">
            ${rows.map((row) => collRow(row, state))}
          </ul>`}
  </section>`;
}

/* ── The zones panel ───────────────────────────────────────────────────── */

function zoneRow(entry: DeckDetail["cards"][number], zone: DeckZone): SafeHtml {
  return html`<li class="zone-edit-row${entry.missing > 0 ? " deck-line-forced" : ""}">
    <span class="zone-edit-main">
      ${thumbnail(entry.imageUrlSmall, "thumb thumb-sm")}
      <span class="zone-edit-text">
        <strong>${entry.name}</strong>
        ${when(
          entry.missing > 0,
          html`<code class="muted"
            >${t("{n} to find — {owned} in collection", {
              n: entry.missing, owned: entry.owned,
            })}</code
          >`,
        )}
        ${banBadge(entry.banlistTcg)}
      </span>
    </span>
    <div class="deck-stepper zone-qty" role="group" aria-label="${entry.name}">
      <button type="button" class="btn-qty js-zone" data-pc="${String(entry.passcode)}" data-d="-1"
              aria-label="${t("Remove a copy")}">−</button>
      <span class="deck-stepper-qty is-in-deck">×${entry[zone]}</span>
      <button type="button" class="btn-qty js-zone" data-pc="${String(entry.passcode)}" data-d="1"
              aria-label="${t("Add a copy")}">+</button>
    </div>
  </li>`;
}

function zonesPanel(state: DeckState, deck: DeckDetail): SafeHtml {
  const inZone = deck.cards.filter((entry) => entry[state.zone] > 0);
  return html`<section class="deck-edit-zones">
    <div class="zone-tabs" role="tablist">
      ${DECK_ZONES.map(
        (zone) => html`<button type="button"
          class="chip chip-zone${state.zone === zone ? " is-active" : ""}"
          data-zone="${zone}" role="tab" aria-selected="${String(state.zone === zone)}"
          >${zoneIcon(zone)} ${ZONE_LABELS[zone]}
          <span class="muted">${deck.counts[zone]}</span></button
        >`,
      )}
    </div>
    <p class="muted zone-hint">
      ${t("The tab decides where “+” goes. Extra Deck monsters always go there.")}
    </p>
    ${inZone.length === 0
      ? html`<p class="muted zone-edit-empty">${t("Empty zone")}</p>`
      : html`<ul class="zone-edit-list">${inZone.map((entry) => zoneRow(entry, state.zone))}</ul>`}
  </section>`;
}

/* ── The two screens ───────────────────────────────────────────────────── */

/**
 * A deck's pill: ready, incomplete, or what is wrong.
 *
 * The same verdict as the workshop's sentence, in one word — `deckStatus`
 * decides, in both cases.
 */
function deckPill(deck: DeckSummary): SafeHtml {
  const status = deckStatus(deck.counts, deck.missing, deck.targetMain);
  return html`<span class="zone-pill ${status.kind === "ready" ? "deck-ready" : "deck-unready"}"
    >${status.kind === "ready"
      ? t("Ready")
      : status.kind === "over"
        ? t("Too many cards")
        : status.kind === "missing"
          ? t("{n} to find", { n: status.missing })
          : t("Incomplete")}</span
  >`;
}

/**
 * A deck's artwork.
 *
 * The server picks the card — the most played one — and the screen only has to
 * place it. An empty deck keeps the card back: it is the only case where there
 * is nothing to show.
 *
 * `alt` is empty, and the link's `title` already carries the deck's name:
 * announcing it twice to a screen reader would be noise, not information.
 */
function deckCover(deck: DeckSummary, cls: string): SafeHtml {
  return deck.coverImage
    ? html`<img class="${cls}" src="${deck.coverImage}" alt="" loading="lazy" decoding="async" />`
    : html`<span class="${cls} deck-cover-default"><span class="deck-cover-ygo">遊戯王</span></span>`;
}

function deckDriveRow(state: DeckState, deck: DeckSummary): SafeHtml {
  return html`<li class="drive-row">
    <a class="drive-main" href="/decks?deck=${deck.id}"
       draggable="true" data-drag-deck="${deck.id}">
      <span class="drive-ico drive-ico-cover" aria-hidden="true">
        ${deckCover(deck, "drive-cover")}
      </span>
      <span class="drive-text"><strong class="drive-name">${deck.name}</strong></span>
      <span class="muted drive-meta"
        >M${deck.counts.main} · E${deck.counts.extra} · S${deck.counts.side}</span
      >
      ${deckPill(deck)}
    </a>
    ${deckMenu(state, deck.id)}
  </li>`;
}

/**
 * The deck in portrait, artwork large.
 *
 * That is ATEM-old's view, and the cover's reason for being: a list of names is
 * only recognised by reading, a board of artworks is recognised at a glance.
 * The 59 / 86 ratio is a card's.
 */
function deckTile(state: DeckState, deck: DeckSummary, path = ""): SafeHtml {
  return html`<li class="deck-tile-li">
    <div class="deck-tile-wrap">
      <a class="deck-tile" href="/decks?deck=${deck.id}" title="${deck.name}"
         draggable="true" data-drag-deck="${deck.id}">
        ${deckCover(deck, "deck-tile-cover")}
        <span class="deck-tile-label">
          <strong class="deck-tile-name">${deck.name}</strong>
          ${when(path !== "", html`<span class="muted deck-tile-meta">📁 ${path}</span>`)}
          <span class="muted deck-tile-meta"
            >M${deck.counts.main} · E${deck.counts.extra} · S${deck.counts.side}</span
          >
          ${deckPill(deck)}
        </span>
      </a>
      ${deckMenu(state, deck.id)}
    </div>
  </li>`;
}

/**
 * What the current level holds — or what the search found.
 *
 * Folders first, decks next: that is the order of every explorer, and it saves
 * looking for a folder in the middle of the files.
 *
 * During a search, no folders at all: you are looking for a deck, not for a
 * filing place, and the answer crosses levels. Each result then says where it
 * comes from.
 */
function contentsHtml(state: DeckState): SafeHtml {
  const query = state.query.trim();
  const gallery = state.listView === "gallery";

  if (query !== "") {
    const found = searchDecks(state, query);
    if (found.length === 0) {
      return html`<div class="empty-state">
        <p class="empty-title">${t("Nothing here")}</p>
        <p class="muted">${t("No deck goes by that name.")}</p>
      </div>`;
    }
    return gallery
      ? html`<ul class="deck-tiles">
          ${found.map((deck) => deckTile(state, deck, deckFolderPath(state, deck)))}
        </ul>`
      : html`<ul class="drive-list">${found.map((deck) => deckDriveRow(state, deck))}</ul>`;
  }

  const folders = childFolders(state, state.folderId);
  const decks = decksIn(state, state.folderId);

  if (folders.length === 0 && decks.length === 0) {
    /**
     * An empty folder keeps its way out.
     *
     * Without it, the only path back up would be the breadcrumb — and the
     * screen with nothing to show would also be the one offering the least to
     * grab hold of.
     */
    return html`${when(
      state.folderId !== null,
      gallery
        ? html`<ul class="deck-tiles">${parentTile(state)}</ul>`
        : html`<ul class="drive-list">${parentRow(state)}</ul>`,
    )}
    <div class="empty-state">
      <p class="empty-title">${state.folderId === null ? t("Nothing here") : t("Empty folder")}</p>
      <p class="muted">
        ${state.folderId === null
          ? t("Build a deck to get started.")
          : t("Move a deck here, or go up one level.")}
      </p>
    </div>`;
  }

  return gallery
    ? html`<ul class="deck-tiles">
        ${parentTile(state)} ${folders.map((folder) => folderTile(state, folder))}
        ${decks.map((deck) => deckTile(state, deck))}
      </ul>`
    : html`<ul class="drive-list">
        ${parentRow(state)} ${folders.map((folder) => folderRow(state, folder))}
        ${decks.map((deck) => deckDriveRow(state, deck))}
      </ul>`;
}

function listHtml(state: DeckState): SafeHtml {
  return html`<main class="decks-page">
    <div class="decks-manage-head">
      <h1>${t("My decks")}</h1>
      <p class="muted">
        ${t("A deck is built from your collection: you only put in what you own.")}
      </p>
    </div>

    ${breadcrumbHtml(state)} ${moveBannerHtml(state)}

    <div class="decks-toolbar">
      <label class="search">
        <span class="search-icon" aria-hidden="true">⌕</span>
        <input type="search" id="deck-search" value="${state.query}"
               placeholder="${t("Search for a deck…")}"
               aria-label="${t("Search for a deck")}" />
      </label>
      <div class="view-toggle" role="group" aria-label="${t("Display")}">
        <button type="button" class="icon-btn${state.listView === "list" ? " is-active" : ""}"
                data-list-view="list" title="${t("List")}" aria-label="${t("List view")}"
                aria-pressed="${String(state.listView === "list")}"><span class="i-list" aria-hidden="true"></span></button>
        <button type="button" class="icon-btn${state.listView === "gallery" ? " is-active" : ""}"
                data-list-view="gallery" title="${t("Gallery")}" aria-label="${t("Gallery view")}"
                aria-pressed="${String(state.listView === "gallery")}"><span class="i-grid" aria-hidden="true"></span></button>
      </div>
      <button type="button" class="btn" id="btn-new-folder">${t("New folder")}</button>
      <button type="button" class="btn btn-primary decks-toolbar-build" id="btn-build">
        ${t("Build a deck")}
      </button>
    </div>

    ${when(state.error, html`<p class="banner banner-err">${state.error}</p>`)}
    ${state.loading ? html`<p class="muted">${t("Loading…")}</p>` : contentsHtml(state)}
    ${modalHtml(state)}
  </main>`;
}

function editHtml(state: DeckState, deck: DeckDetail): SafeHtml {
  return html`<main class="decks-page">
    <div class="deck-edit-head">
      <div class="deck-edit-fields">
        <label class="menu-field grow">
          ${t("Deck name")}
          <input type="text" id="edit-name" maxlength="60" value="${deck.name}"
                 placeholder="${t("Unique name…")}" />
        </label>
      </div>
      <div class="deck-edit-actions">
        <!--
          No save button, and that is intended.
          Ange: “either you update everything or you update nothing, but not
          just half of it”. Cards leave at every “±”; the name leaves when the
          typing settles and when the field hands focus back. The counts bar
          says “Saved” in both cases.

          No bin here either: discarding a deck is a gesture on the object, not
          on its building, and it lives on the sheet. Two places to delete is
          one too many.
        -->
        <button type="button" class="btn" id="btn-deck-options">${t("Options")}</button>
        <a class="btn" href="/decks?deck=${deck.id}">${t("← Sheet")}</a>
        <a class="btn" href="/decks">${t("All decks")}</a>
      </div>
    </div>

    ${countsBar(deck, state)} ${deckStatusHtml(deck)}
    ${when(state.error, html`<p class="banner banner-err">${state.error}</p>`)}

    <!--
      Toggle between the two panels, below 900px only.

      Stacked, they force you to scroll the whole collection to get to your deck
      — that is, at every card added. The toggle does not exist on a wide
      screen, where the two fit side by side.
    -->
    <div class="deck-panel-switch" role="tablist" aria-label="${t("Visible panel")}">
      <button type="button" class="chip${state.panel === "collection" ? " is-active" : ""}"
              role="tab" aria-selected="${String(state.panel === "collection")}"
              data-panel="collection">📚 ${t("My collection")}</button>
      <button type="button" class="chip${state.panel === "zones" ? " is-active" : ""}"
              role="tab" aria-selected="${String(state.panel === "zones")}"
              data-panel="zones">🃏 ${t("My deck")}
        <span class="muted">${deck.counts[state.zone]}</span></button>
    </div>

    <div class="deck-edit-layout is-panel-${state.panel === "collection" ? "coll" : "zone"}">
      ${collectionPanel(state)}
      ${zonesPanel(state, deck)}
    </div>
    <!--
      The same window as the list's, and it must be rendered here too: the
      workshop is a different screen, so a modal left in the list's markup opens
      on nothing. Found by the test, not by reading.
    -->
    ${modalHtml(state)}
  </main>`;
}

/** The refusal reasons, in the screen's words. Same keys as the server. */
const REFUSAL_LABELS: Record<string, string> = {
  forbidden: "This card is forbidden by the banlist.",
  banlist: "The banlist does not allow that many.",
  not_owned: "You do not own enough copies of this card.",
  max_copies: "A deck may hold no more than 3 copies of a card.",
};

/**
 * What the filters let through.
 *
 * The same categories as the Collection screen, plus “Extra” — which makes no
 * sense there and makes some here: it is the only pile filled separately.
 */
export function visibleCollection(state: DeckState): CollectionRow[] {
  const q = state.query.trim().toLowerCase();
  return state.collection.filter((row) => {
    const card = row.card;
    if (q) {
      const haystack = `${card?.name ?? ""} ${row.setCode} ${card?.passcode ?? ""}`.toLowerCase();
      if (!haystack.includes(q.replace(/^#/, ""))) return false;
    }
    if (state.attributes.length > 0 && !state.attributes.includes(card?.attribute ?? "")) {
      return false;
    }
    switch (state.kind) {
      case "monster":
        return Boolean(card) && !/Spell|Trap/.test(card!.type ?? "");
      case "spell":
        return (card?.type ?? "").includes("Spell");
      case "trap":
        return (card?.type ?? "").includes("Trap");
      case "extra":
        return isExtraDeckCard({ type: card?.type ?? null, frameType: card?.frameType ?? null });
      case "fav":
        return row.isFavorite;
      default:
        return true;
    }
  });
}

/**
 * The card sheet, seen from the workshop.
 *
 * The same one as in the collection — it is the same card, it must read the
 * same. What changes is what you can do from there: put a copy in the active
 * zone, or take one out.
 */
function cardSheet(state: DeckState): SafeHtml {
  const row = state.collection.find((row) => row.card?.passcode === state.openedCard);
  const card = row?.card;
  if (!row || !card) return raw("");

  const already = inDeck(card.passcode);
  const issue = checkDeckAdd({
    banlistTcg: card.banlistTcg,
    owned: state.owned.get(card.passcode) ?? 0,
    inDeck: already,
  });
  const refusal = issue.blockedBy ? REFUSAL_LABELS[issue.blockedBy] : null;

  return cardSheetHtml({
    art: card.imageUrl ?? card.imageUrlSmall,
    title: card.name,
    subtitle: `${row.setCode} · #${card.passcode}`,
    card: card,
    extra: html`<div class="deck-open-actions">
      <p class="muted">
        ${t("In the deck")} : <strong class="in-deck-qty-label">×${already}</strong> ·
        ${t("Active zone")} : ${ZONE_LABELS[state.zone]}
      </p>
      <div class="deck-open-btns">
        <button type="button" class="btn btn-primary js-coll" data-pc="${String(card.passcode)}"
                data-d="1" title="${refusal ? t(refusal) : t("Add to deck")}"
                ${issue.canAdd ? raw("") : raw("disabled")}>+1</button>
        <button type="button" class="btn js-coll" data-pc="${String(card.passcode)}" data-d="-1"
                ${already > 0 ? raw("") : raw("disabled")}>−1</button>
      </div>
    </div>`,
  });
}

/* ── The deck sheet ───────────────────────────────────────────────────────
 *
 * **Opening a deck shows it, it does not open it for writing.** Taken from
 * ATEM-old (`renderDetail`): the sheet lists the cards as the collection lists
 * them, and the pencil leads to the workshop. No control writes here.
 */

type SheetRow = { entry: DeckDetail["cards"][number]; zone: DeckZone; qty: number };

/**
 * The sheet's rows, one per occupied zone.
 *
 * The same card can be in the Main and in the Side: that is two rows, because
 * it is two places in the deck. On “All zones”, both are visible.
 */
function sheetEntries(deck: DeckDetail, zone: "all" | DeckZone, query: string): SheetRow[] {
  const q = query.trim().toLowerCase();
  const rows: SheetRow[] = [];
  for (const entry of deck.cards) {
    if (q && !entry.name.toLowerCase().includes(q) && !String(entry.passcode).includes(q)) continue;
    for (const z of DECK_ZONES) {
      if ((zone === "all" || zone === z) && entry[z] > 0) rows.push({ entry, zone: z, qty: entry[z] });
    }
  }
  return rows;
}

function sheetRow({ entry, zone, qty }: SheetRow): SafeHtml {
  return html`<li class="item">
    <div class="item-row">
      <button type="button" class="item-main js-open-card" data-pc="${String(entry.passcode)}">
        ${thumbnail(entry.imageUrlSmall, "thumb")}
        <span class="item-text">
          <strong>${entry.name}</strong>
          <span class="item-meta">
            <span class="qty-pill">×${qty}</span>
            <span class="zone-pill">${zoneIcon(zone)} ${ZONE_LABELS[zone]}</span>
            ${banBadge(entry.banlistTcg)}
          </span>
        </span>
      </button>
    </div>
  </li>`;
}

function sheetTile({ entry, zone, qty }: SheetRow): SafeHtml {
  return html`<div class="tile deck-sheet-tile">
    <button type="button" class="tile-open js-open-card" data-pc="${String(entry.passcode)}">
      <div class="tile-art">
        ${entry.imageUrlSmall
          ? html`<img loading="lazy" decoding="async" src="${entry.imageUrlSmall}" alt="" />`
          : raw(`<div class="tile-art-empty">?</div>`)}
        <span class="tile-qty">×${qty}</span>
        <span class="tile-zone">${zoneIcon(zone)}</span>
      </div>
      <div class="tile-body">
        <strong class="tile-name">${entry.name}</strong>
        ${banBadge(entry.banlistTcg)}
      </div>
    </button>
  </div>`;
}

function sheetHtml(state: DeckState, deck: DeckDetail): SafeHtml {
  const rows = sheetEntries(deck, state.sheetZone, state.query);
  const total = deck.counts.main + deck.counts.extra + deck.counts.side;
  const folder = state.folders.find((f) => f.id === deck.folderId);

  return html`<main class="decks-page">
    <div class="deck-sheet-top">
      <div class="deck-sheet-identity">
        <span class="deck-sheet-cover">${deckCover(deck, "deck-sheet-art")}</span>
        <div class="deck-sheet-titles">
          <h1>${deck.name}</h1>
          <p class="muted deck-sheet-place">
            ${when(folder !== undefined, html`📁 ${folder?.path.join(" / ") ?? ""}`)}
            ${when(folder === undefined, html`📁 ${t("Root")}`)}
          </p>
        </div>
      </div>
      <div class="deck-sheet-actions">
        <a class="btn" href="/decks">${t("All decks")}</a>
        <a class="icon-btn" id="btn-edit-deck" href="/decks?deck=${deck.id}&workshop=1"
           title="${t("Edit")}" aria-label="${t("Edit")}">✏️</a>
        <button type="button" class="icon-btn btn-icon-danger" id="btn-delete"
                title="${t("Discard this deck")}" aria-label="${t("Discard this deck")}">🗑</button>
      </div>
    </div>

    ${countsBar(deck, state)} ${deckStatusHtml(deck)}
    ${when(state.error, html`<p class="banner banner-err">${state.error}</p>`)}

    <div class="decks-toolbar">
      <label class="search">
        <span class="search-icon" aria-hidden="true">⌕</span>
        <input type="search" id="deck-search" value="${state.query}"
               placeholder="${t("Search for a card…")}"
               aria-label="${t("Search for a card")}" />
      </label>
      <div class="view-toggle" role="group" aria-label="${t("Display")}">
        <button type="button" class="icon-btn${state.sheetView === "list" ? " is-active" : ""}"
                data-sheet-view="list" title="${t("List")}" aria-label="${t("List view")}"
                aria-pressed="${String(state.sheetView === "list")}"><span class="i-list" aria-hidden="true"></span></button>
        <button type="button" class="icon-btn${state.sheetView === "gallery" ? " is-active" : ""}"
                data-sheet-view="gallery" title="${t("Gallery")}" aria-label="${t("Gallery view")}"
                aria-pressed="${String(state.sheetView === "gallery")}"><span class="i-grid" aria-hidden="true"></span></button>
      </div>
    </div>

    <div class="zone-tabs" role="tablist">
      <button type="button" class="chip chip-zone${state.sheetZone === "all" ? " is-active" : ""}"
              data-sheet-zone="all" role="tab" aria-selected="${String(state.sheetZone === "all")}"
        >${t("All zones")} <span class="muted">${total}</span></button
      >
      ${DECK_ZONES.map(
        (zone) => html`<button type="button"
          class="chip chip-zone${state.sheetZone === zone ? " is-active" : ""}"
          data-sheet-zone="${zone}" role="tab" aria-selected="${String(state.sheetZone === zone)}"
          >${zoneIcon(zone)} ${ZONE_LABELS[zone]} <span class="muted">${deck.counts[zone]}</span></button
        >`,
      )}
    </div>

    ${rows.length === 0
      ? html`<div class="empty-state">
          <p class="empty-title">${t("No cards")}</p>
          <p class="muted">${t("Open the workshop to add some.")}</p>
        </div>`
      : state.sheetView === "gallery"
        ? html`<div class="gallery" data-cols="6">${rows.map(sheetTile)}</div>`
        : html`<ul class="item-list">${rows.map(sheetRow)}</ul>`}
  </main>`;
}

/**
 * The card opened from the sheet — with nothing to write with.
 *
 * The workshop offers “+1” and “−1” on the same card sheet; here there is only
 * the card. That is what makes this screen a reading, and not a workshop whose
 * buttons have been hidden.
 */
function sheetCard(state: DeckState): SafeHtml {
  const card = state.openedCard === null ? undefined : state.cardDetails.get(state.openedCard);
  if (!card) return raw("");
  return cardSheetHtml({
    art: card.imageUrl ?? card.imageUrlSmall,
    title: card.name,
    subtitle: `#${card.passcode}`,
    card: card,
  });
}

export function deckHtml(state: DeckState): SafeHtml {
  if (!state.opened) return listHtml(state);
  if (!state.editing) {
    return html`${sheetHtml(state, state.opened)}${when(state.openedCard !== null, sheetCard(state))}`;
  }
  return html`${editHtml(state, state.opened)}${when(state.openedCard !== null, cardSheet(state))}`;
}

/** The zone a card must go to, whichever one is being looked at. */
export function zoneFor(
  card: { type: string | null; frameType: string | null },
  current: DeckZone,
): DeckZone {
  if (current === "side") return "side";
  return isExtraDeckCard(card) ? "extra" : "main";
}
