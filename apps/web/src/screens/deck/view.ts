/**
 * Le balisage des decks — la liste et l'atelier.
 *
 * **Transcrit d'ATEM-old**, dont l'interface avait été validée : `decks/vue.ts`,
 * `vue-atelier.ts` et `vue-pieces.ts`, avec les classes de
 * `styles/pages/decks.css`. Ce qui n'est pas repris ne l'est pas par oubli mais
 * faute de quoi le brancher — les dossiers, la modale d'options de deck et le
 * tableau de banlist n'ont pas d'appui côté serveur chez nous, et un contrôle
 * qui ne fait rien est pire que pas de contrôle.
 *
 * La panneau de collection emploie les **mêmes classes que l'écran Collection**
 * — `.item`, `.item-row`, `.item-main`, `.thumb` — et c'est voulu : on y pioche
 * dans la même chose, elle doit se lire pareil.
 */
import {
  DECK_ZONE_LIMITS, DECK_ZONES, checkDeckAdd, deckIsPlayable, isExtraDeckCard,
  parseBanlistStatus, type BanlistStatus, type DeckZone,
} from "@atem/shared";
import { t } from "../../platform/i18n/index.js";
import { cardSheetHtml } from "../shared/card-sheet.js";
import { translateAttribute } from "../../platform/ygo-labels.js";
import { html, raw, when, type SafeHtml } from "../../platform/ui.js";
import {
  inDeck, type CollectionRow, type DeckDetail, type DeckState, type DeckSummary,
} from "./state.js";

/** Les attributs, dans l'ordre où la maquette les range. */
const ATTRS = ["DARK", "LIGHT", "EARTH", "WATER", "FIRE", "WIND", "DIVINE"];

/**
 * Les libellés de banlist — traduits à l'affichage, pas à la déclaration.
 *
 * Cette table est évaluée à l'import, avant que la langue du compte soit connue.
 */
const BAN_LABELS: Record<BanlistStatus, string> = {
  forbidden: "Interdite",
  limited: "Limitée à 1",
  semi_limited: "Limitée à 2",
  unlimited: "",
};

const KIND_LABELS: Record<string, string> = {
  "": "Tout",
  monster: "Monstre",
  spell: "Magie",
  trap: "Piège",
  extra: "Extra",
  fav: "★",
};

/* ── Les pièces ────────────────────────────────────────────────────────── */

/**
 * Les icônes de zone, reprises telles quelles.
 *
 * Main : une pile. Extra : une étoile. Side : des couches. Elles distinguent
 * les trois onglets sans les lire, ce qui compte quand on y revient cent fois.
 */
function zoneIcon(zone: DeckZone): SafeHtml {
  const chemins: Record<DeckZone, string> = {
    main: `<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h6M9 11h6M9 15h4"/>`,
    extra: `<path d="M12 2l4 8 8 1-6 5 2 8-8-4-8 4 2-8-6-5 8-1z"/>`,
    side: `<path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 12l10 5 10-5"/><path d="M2 17l10 5 10-5"/>`,
  };
  return raw(
    `<svg class="zone-ico zone-ico-${zone}" viewBox="0 0 24 24" width="14" height="14" ` +
      `aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2">${chemins[zone]}</svg>`,
  );
}

/** La pastille de banlist — rien du tout quand la carte est illimitée. */
function banBadge(banlistTcg: string | null | undefined): SafeHtml {
  const statut = parseBanlistStatus(banlistTcg);
  if (statut === "unlimited") return raw("");
  const classe =
    statut === "forbidden" ? "ban-badge-forbidden"
    : statut === "limited" ? "ban-badge-limited"
    : "ban-badge-semi";
  return html`<span class="ban-badge ${classe}"
    >${when(statut === "forbidden", raw(`<span class="ban-slash"></span>`))}${t(
      BAN_LABELS[statut],
    )}</span
  >`;
}

const vignette = (url: string | null | undefined, classe = "thumb"): SafeHtml =>
  url
    ? html`<img loading="lazy" decoding="async" class="${classe}" src="${url}" alt="" />`
    : raw(`<div class="thumb-empty ${classe === "thumb" ? "" : classe}">?</div>`);

/**
 * Le compteur de zones, avec ses limites.
 *
 * C'est la seule chose qu'on regarde en construisant : combien il en manque, et
 * si l'on a dépassé. `count-full` dit « c'est plein » sans crier ; `count-over`
 * crie, parce qu'un deck au-dessus de la limite est injouable.
 */
function countsBar(deck: DeckDetail, state: DeckState): SafeHtml {
  return html`<p class="meta-line deck-counts">
    ${DECK_ZONES.map((zone) => {
      const { min, max } = DECK_ZONE_LIMITS[zone];
      const n = deck.counts[zone];
      const classe = n > max ? "count-over" : n >= max ? "count-full" : n < min ? "count-short" : "";
      return html`<span class="${classe}"
        >${zoneIcon(zone)} ${ZONE_LABELS[zone]} <strong>${n}</strong>/${max}</span
      >`;
    })}
    ${when(
      deck.missing > 0,
      html`<span class="warn">${t("{n} à retrouver", { n: deck.missing })}</span>`,
    )}
    ${when(
      state.savedAt !== null,
      html`<span class="deck-saved">${t("Enregistré")}</span>`,
    )}
  </p>`;
}

const ZONE_LABELS: Record<DeckZone, string> = { main: "Main", extra: "Extra", side: "Side" };

/**
 * Le pas d'une carte : « −1 ×n +1 ».
 *
 * Le même objet dans la liste et dans la galerie, où il se pose par-dessus
 * l'illustration plutôt que sous la vignette — la grille reste alignée.
 */
function stepper(row: CollectionRow, state: DeckState, compact = false): SafeHtml {
  const passcode = row.card?.passcode ?? 0;
  const déjà = inDeck(passcode);
  const issue = checkDeckAdd({
    banlistTcg: row.card?.banlistTcg,
    owned: state.owned.get(passcode) ?? 0,
    inDeck: déjà,
  });
  const refus = issue.blockedBy ? REFUS_LABELS[issue.blockedBy] : null;

  return html`<div class="${compact ? "deck-stepper deck-stepper-overlay" : "deck-stepper item-actions"}"
    role="group" aria-label="${t("Quantité dans le deck")}">
    <button type="button" class="btn-qty js-coll" data-pc="${String(passcode)}" data-d="-1"
            aria-label="${t("Retirer un exemplaire")}"
            ${déjà > 0 ? raw("") : raw("disabled")}>${compact ? "−" : "−1"}</button>
    <span class="deck-stepper-qty${déjà > 0 ? " is-in-deck" : ""}">×${déjà}</span>
    <button type="button" class="btn-qty js-coll" data-pc="${String(passcode)}" data-d="1"
            aria-label="${t("Ajouter un exemplaire")}"
            title="${refus ? t(refus) : t("Ajouter au deck")}"
            ${issue.canAdd ? raw("") : raw("disabled")}>${compact ? "+" : "+1"}</button>
  </div>`;
}

/* ── Le panneau de collection ──────────────────────────────────────────── */

function collRow(row: CollectionRow, state: DeckState): SafeHtml {
  const carte = row.card;
  const passcode = carte?.passcode ?? 0;
  const déjà = inDeck(passcode);
  const interdite = parseBanlistStatus(carte?.banlistTcg) === "forbidden";

  return html`<li class="item${interdite ? " card-ban-forbidden" : ""}${déjà > 0 ? " in-deck-selected" : ""}">
    <div class="item-row">
      <button type="button" class="item-main js-open-card" data-pc="${String(passcode)}">
        ${vignette(carte?.imageUrlSmall ?? carte?.imageUrl)}
        <div class="item-text">
          <strong>${carte?.name ?? t("Carte non identifiée")}</strong>
          <code>${row.setCode}</code>
          <div class="item-meta">
            <span>${t("×{n} poss.", { n: state.owned.get(passcode) ?? 0 })}</span>
            ${when(row.isFavorite, raw(`<span class="ok-tag fav-tag">★</span>`))}
            ${banBadge(carte?.banlistTcg)}
          </div>
        </div>
        ${when(déjà > 0, html`<span class="in-deck-qty" aria-label="${t("Dans le deck")}">×${déjà}</span>`)}
      </button>
      ${stepper(row, state)}
    </div>
  </li>`;
}

function collTile(row: CollectionRow, state: DeckState): SafeHtml {
  const carte = row.card;
  const passcode = carte?.passcode ?? 0;
  const déjà = inDeck(passcode);

  return html`<div class="tile deck-coll-tile${déjà > 0 ? " in-deck-selected" : ""}">
    <div class="tile-art-wrap">
      <button type="button" class="tile-open js-open-card" data-pc="${String(passcode)}">
      <div class="tile-art">
        ${carte?.imageUrlSmall || carte?.imageUrl
          ? html`<img loading="lazy" decoding="async" src="${carte.imageUrlSmall ?? carte.imageUrl!}" alt="" />`
          : raw(`<div class="tile-art-empty">?</div>`)}
        ${déjà > 0
          ? html`<span class="in-deck-qty">×${déjà}</span>`
          : html`<span class="tile-qty muted-own">×${state.owned.get(passcode) ?? 0}</span>`}
      </div>
      </button>
      ${stepper(row, state, true)}
    </div>
    <button type="button" class="tile-body tile-open js-open-card" data-pc="${String(passcode)}">
      <strong class="tile-name">${carte?.name ?? t("Carte non identifiée")}</strong>
      <code>${row.setCode}</code>${banBadge(carte?.banlistTcg)}
    </button>
  </div>`;
}

function collectionPanel(state: DeckState): SafeHtml {
  const lignes = visibleCollection(state);

  return html`<section class="deck-edit-collection">
    <div class="decks-toolbar">
      <label class="search">
        <span class="search-icon" aria-hidden="true">⌕</span>
        <input type="search" id="coll-search" value="${state.query}"
               placeholder="${t("Nom, set code ou #passcode…")}"
               aria-label="${t("Rechercher dans la collection")}" />
      </label>
      <div class="view-toggle" role="group" aria-label="${t("Affichage")}">
        <button type="button" class="icon-btn${state.collView === "list" ? " is-active" : ""}"
                data-coll-view="list" title="${t("Liste")}" aria-label="${t("Vue liste")}"
                aria-pressed="${String(state.collView === "list")}"><span class="i-list" aria-hidden="true"></span></button>
        <button type="button" class="icon-btn${state.collView === "gallery" ? " is-active" : ""}"
                data-coll-view="gallery" title="${t("Galerie")}" aria-label="${t("Vue galerie")}"
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

    ${lignes.length === 0
      ? html`<p class="muted">${t("Aucune carte (collection ou filtres).")}</p>`
      : state.collView === "gallery"
        ? html`<div class="gallery deck-edit-gallery" data-cols="6">
            ${lignes.map((row) => collTile(row, state))}
          </div>`
        : html`<ul class="item-list deck-edit-coll-list">
            ${lignes.map((row) => collRow(row, state))}
          </ul>`}
  </section>`;
}

/* ── Le panneau des zones ──────────────────────────────────────────────── */

function zoneRow(entry: DeckDetail["cards"][number], zone: DeckZone): SafeHtml {
  return html`<li class="zone-edit-row${entry.missing > 0 ? " deck-line-forced" : ""}">
    <span class="zone-edit-main">
      ${vignette(entry.imageUrlSmall, "thumb thumb-sm")}
      <span class="zone-edit-text">
        <strong>${entry.name}</strong>
        ${when(
          entry.missing > 0,
          html`<code class="muted"
            >${t("{n} à retrouver — {owned} en collection", {
              n: entry.missing, owned: entry.owned,
            })}</code
          >`,
        )}
        ${banBadge(entry.banlistTcg)}
      </span>
    </span>
    <div class="deck-stepper zone-qty" role="group" aria-label="${entry.name}">
      <button type="button" class="btn-qty js-zone" data-pc="${String(entry.passcode)}" data-d="-1"
              aria-label="${t("Retirer un exemplaire")}">−</button>
      <span class="deck-stepper-qty is-in-deck">×${entry[zone]}</span>
      <button type="button" class="btn-qty js-zone" data-pc="${String(entry.passcode)}" data-d="1"
              aria-label="${t("Ajouter un exemplaire")}">+</button>
    </div>
  </li>`;
}

function zonesPanel(state: DeckState, deck: DeckDetail): SafeHtml {
  const dansLaZone = deck.cards.filter((entry) => entry[state.zone] > 0);
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
      ${t("L'onglet dit où vont les « + ». Les monstres d'Extra Deck y vont toujours.")}
    </p>
    ${dansLaZone.length === 0
      ? html`<p class="muted zone-edit-empty">${t("Zone vide")}</p>`
      : html`<ul class="zone-edit-list">${dansLaZone.map((entry) => zoneRow(entry, state.zone))}</ul>`}
  </section>`;
}

/* ── Les deux écrans ───────────────────────────────────────────────────── */

function deckDriveRow(deck: DeckSummary): SafeHtml {
  const jouable = deckIsPlayable(deck.counts, deck.missing);
  return html`<li class="drive-row">
    <a class="drive-main" href="/decks?deck=${deck.id}">
      <span class="drive-ico drive-ico-cover" aria-hidden="true">
        <span class="drive-cover deck-cover-default"><span class="deck-cover-ygo">遊戯王</span></span>
      </span>
      <span class="drive-text"><strong class="drive-name">${deck.name}</strong></span>
      <span class="muted drive-meta"
        >M${deck.counts.main} · E${deck.counts.extra} · S${deck.counts.side}</span
      >
      <span class="zone-pill ${jouable ? "deck-ready" : "deck-unready"}"
        >${jouable
          ? t("Prêt")
          : deck.missing > 0
            ? t("{n} à retrouver", { n: deck.missing })
            : t("Incomplet")}</span
      >
    </a>
  </li>`;
}

function listHtml(state: DeckState): SafeHtml {
  const visibles = state.decks.filter((deck) =>
    deck.name.toLowerCase().includes(state.query.trim().toLowerCase()),
  );

  return html`<main class="decks-page">
    <div class="decks-manage-head">
      <h1>${t("Mes decks")}</h1>
      <p class="muted">
        ${t("Un deck se construit depuis votre collection : on n'y met que ce qu'on possède.")}
      </p>
    </div>

    <div class="decks-toolbar">
      <label class="search">
        <span class="search-icon" aria-hidden="true">⌕</span>
        <input type="search" id="deck-search" value="${state.query}"
               placeholder="${t("Rechercher un deck…")}"
               aria-label="${t("Rechercher un deck")}" />
      </label>
      <button type="button" class="btn btn-primary decks-toolbar-build" id="btn-build">
        ${t("Construire un deck")}
      </button>
    </div>

    ${when(state.error, html`<p class="banner banner-err">${state.error}</p>`)}
    ${state.loading
      ? html`<p class="muted">${t("Chargement…")}</p>`
      : visibles.length === 0
        ? html`<div class="empty-state">
            <p class="empty-title">${t("Rien ici")}</p>
            <p class="muted">${t("Construisez un deck pour commencer.")}</p>
          </div>`
        : html`<ul class="drive-list">${visibles.map(deckDriveRow)}</ul>`}
  </main>`;
}

function editHtml(state: DeckState, deck: DeckDetail): SafeHtml {
  return html`<main class="decks-page">
    <div class="deck-edit-head">
      <div class="deck-edit-fields">
        <label class="menu-field grow">
          ${t("Nom du deck")}
          <input type="text" id="edit-name" maxlength="60" value="${deck.name}"
                 placeholder="${t("Nom unique…")}" />
        </label>
      </div>
      <div class="deck-edit-actions">
        <a class="btn" href="/decks">${t("Tous les decks")}</a>
        <!--
          « Renommer », et non « Enregistrer ».
          Les cartes s'écrivent à chaque « ± » : un bouton qui promettait
          d'enregistrer le deck laissait croire qu'elles attendaient, et
          répondait « rien à enregistrer » juste après qu'on en avait retiré
          une. Il ne touche que le nom, il le dit.
        -->
        <button type="button" class="btn btn-primary" id="btn-save">${t("Renommer")}</button>
        <button type="button" class="icon-btn btn-icon-danger" id="btn-delete"
                title="${t("Jeter ce deck")}" aria-label="${t("Jeter ce deck")}">🗑</button>
      </div>
    </div>

    ${countsBar(deck, state)}
    ${when(state.error, html`<p class="banner banner-err">${state.error}</p>`)}

    <!--
      Bascule entre les deux panneaux, sous 900px seulement.

      Empilés, ils obligent à faire défiler la collection entière pour passer à
      son deck — c'est-à-dire à chaque carte ajoutée. La bascule n'existe pas
      sur grand écran, où les deux tiennent côte à côte.
    -->
    <div class="deck-panel-switch" role="tablist" aria-label="${t("Panneau affiché")}">
      <button type="button" class="chip${state.panel === "collection" ? " is-active" : ""}"
              role="tab" aria-selected="${String(state.panel === "collection")}"
              data-panel="collection">📚 ${t("Ma collection")}</button>
      <button type="button" class="chip${state.panel === "zones" ? " is-active" : ""}"
              role="tab" aria-selected="${String(state.panel === "zones")}"
              data-panel="zones">🃏 ${t("Mon deck")}
        <span class="muted">${deck.counts[state.zone]}</span></button>
    </div>

    <div class="deck-edit-layout is-panneau-${state.panel === "collection" ? "coll" : "zone"}">
      ${collectionPanel(state)}
      ${zonesPanel(state, deck)}
    </div>
  </main>`;
}

/** Les raisons de refus, dans les mots de l'écran. Mêmes clés que le serveur. */
const REFUS_LABELS: Record<string, string> = {
  forbidden: "Cette carte est interdite par la banlist.",
  banlist: "La banlist n'en autorise pas autant.",
  not_owned: "Vous ne possédez pas assez d'exemplaires de cette carte.",
  max_copies: "Un deck ne porte pas plus de 3 exemplaires d'une carte.",
};

/**
 * Ce que les filtres laissent passer.
 *
 * Les mêmes catégories que l'écran Collection, plus « Extra » — qui n'y a pas
 * de sens et qui en a un ici : c'est la seule pile qu'on remplit à part.
 */
export function visibleCollection(state: DeckState): CollectionRow[] {
  const q = state.query.trim().toLowerCase();
  return state.collection.filter((row) => {
    const carte = row.card;
    if (q) {
      const cible = `${carte?.name ?? ""} ${row.setCode} ${carte?.passcode ?? ""}`.toLowerCase();
      if (!cible.includes(q.replace(/^#/, ""))) return false;
    }
    if (state.attributes.length > 0 && !state.attributes.includes(carte?.attribute ?? "")) {
      return false;
    }
    switch (state.kind) {
      case "monster":
        return Boolean(carte) && !/Spell|Trap/.test(carte!.type ?? "");
      case "spell":
        return (carte?.type ?? "").includes("Spell");
      case "trap":
        return (carte?.type ?? "").includes("Trap");
      case "extra":
        return isExtraDeckCard({ type: carte?.type ?? null, frameType: carte?.frameType ?? null });
      case "fav":
        return row.isFavorite;
      default:
        return true;
    }
  });
}

/**
 * La fiche de carte, vue depuis l'atelier.
 *
 * La même que dans la collection — c'est la même carte, elle doit se lire
 * pareil. Ce qui change, c'est ce qu'on peut faire depuis là : poser un
 * exemplaire dans la zone active, ou en retirer un.
 */
function cardSheet(state: DeckState): SafeHtml {
  const row = state.collection.find((ligne) => ligne.card?.passcode === state.openedCard);
  const carte = row?.card;
  if (!row || !carte) return raw("");

  const déjà = inDeck(carte.passcode);
  const issue = checkDeckAdd({
    banlistTcg: carte.banlistTcg,
    owned: state.owned.get(carte.passcode) ?? 0,
    inDeck: déjà,
  });
  const refus = issue.blockedBy ? REFUS_LABELS[issue.blockedBy] : null;

  return cardSheetHtml({
    art: carte.imageUrl ?? carte.imageUrlSmall,
    title: carte.name,
    subtitle: `${row.setCode} · #${carte.passcode}`,
    card: carte,
    extra: html`<div class="deck-open-actions">
      <p class="muted">
        ${t("Dans le deck")} : <strong class="in-deck-qty-label">×${déjà}</strong> ·
        ${t("Zone active")} : ${ZONE_LABELS[state.zone]}
      </p>
      <div class="deck-open-btns">
        <button type="button" class="btn btn-primary js-coll" data-pc="${String(carte.passcode)}"
                data-d="1" title="${refus ? t(refus) : t("Ajouter au deck")}"
                ${issue.canAdd ? raw("") : raw("disabled")}>+1</button>
        <button type="button" class="btn js-coll" data-pc="${String(carte.passcode)}" data-d="-1"
                ${déjà > 0 ? raw("") : raw("disabled")}>−1</button>
      </div>
    </div>`,
  });
}

export function deckHtml(state: DeckState): SafeHtml {
  if (!state.opened) return listHtml(state);
  return html`${editHtml(state, state.opened)}${when(state.openedCard !== null, cardSheet(state))}`;
}

/** La zone où une carte doit aller, quelle que soit celle qu'on regarde. */
export function zoneFor(
  card: { type: string | null; frameType: string | null },
  courante: DeckZone,
): DeckZone {
  if (courante === "side") return "side";
  return isExtraDeckCard(card) ? "extra" : "main";
}
