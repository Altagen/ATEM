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
      state.savedAt !== null,
      html`<span class="deck-saved">${t("Enregistré")}</span>`,
    )}
  </p>`;
}

const ZONE_LABELS: Record<DeckZone, string> = { main: "Main", extra: "Extra", side: "Side" };

/**
 * Où en est le deck, en une phrase.
 *
 * Ange : « on est à 4/60, on peut mettre "Deck incomplet" ou ce genre de
 * choses ? ». `Main 4/60` est un chiffre : il faut connaître la règle des
 * quarante cartes pour savoir s'il est bon. La phrase dit le reste à faire, en
 * nombre de cartes, pour qu'on n'ait pas à soustraire de tête.
 *
 * **Une seule phrase à la fois** — le verdict vient de `deckStatus`, dans
 * `@atem/shared`, qui range les états par gravité. La même fonction habille la
 * pastille de la liste : deux écrans, un seul jugement.
 */
function deckStatusHtml(deck: DeckDetail): SafeHtml {
  const statut = deckStatus(deck.counts, deck.missing);
  switch (statut.kind) {
    case "over":
      return html`<p class="deck-status deck-status-over">
        ⚠
        ${t("Trop de cartes : {n} à retirer du {zone}.", {
          n: statut.excess,
          zone: ZONE_LABELS[statut.zone],
        })}
      </p>`;
    case "missing":
      // Ça n'arrive pas en construisant — le « + » s'y refuse — mais ça arrive
      // quand on retire ensuite une carte de sa collection.
      return html`<p class="deck-status deck-status-over">
        ⚠ ${t("{n} à retrouver : le deck en compte plus que votre collection.", {
          n: statut.missing,
        })}
      </p>`;
    case "empty":
      return html`<p class="deck-status deck-status-short">
        ${t("Deck vide — posez vos premières cartes depuis la collection.")}
      </p>`;
    case "short":
      return html`<p class="deck-status deck-status-short">
        ${t("Deck incomplet : encore {n} au Main (minimum {min}).", {
          n: statut.missing,
          min: statut.min,
        })}
      </p>`;
    case "ready":
      return html`<p class="deck-status deck-status-ready">✓ ${t("Deck jouable.")}</p>`;
  }
}

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

/**
 * La pastille d'un deck : prêt, incomplet, ou ce qui cloche.
 *
 * Le même verdict que la phrase de l'atelier, en un mot — c'est `deckStatus`
 * qui décide, dans les deux cas.
 */
function deckPill(deck: DeckSummary): SafeHtml {
  const statut = deckStatus(deck.counts, deck.missing);
  return html`<span class="zone-pill ${statut.kind === "ready" ? "deck-ready" : "deck-unready"}"
    >${statut.kind === "ready"
      ? t("Prêt")
      : statut.kind === "over"
        ? t("Trop de cartes")
        : statut.kind === "missing"
          ? t("{n} à retrouver", { n: statut.missing })
          : t("Incomplet")}</span
  >`;
}

/**
 * L'illustration d'un deck.
 *
 * Le serveur choisit la carte — celle qu'on joue le plus — et l'écran n'a qu'à
 * la poser. Un deck vide garde le dos de carte : c'est le seul cas où il n'y a
 * rien à montrer.
 *
 * `alt` est vide, et le `title` du lien porte déjà le nom du deck : l'annoncer
 * deux fois à un lecteur d'écran ferait du bruit, pas de l'information.
 */
function deckCover(deck: DeckSummary, classe: string): SafeHtml {
  return deck.coverImage
    ? html`<img class="${classe}" src="${deck.coverImage}" alt="" loading="lazy" decoding="async" />`
    : html`<span class="${classe} deck-cover-default"><span class="deck-cover-ygo">遊戯王</span></span>`;
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
 * Le deck en portrait, illustration en grand.
 *
 * C'est la vue d'ATEM-old, et la raison d'être de la couverture : une liste de
 * noms ne se reconnaît qu'en lisant, une planche d'illustrations se reconnaît
 * d'un coup d'œil. Le format 59 / 86 est celui d'une carte.
 */
function deckTile(state: DeckState, deck: DeckSummary, chemin = ""): SafeHtml {
  return html`<li class="deck-tile-li">
    <div class="deck-tile-wrap">
      <a class="deck-tile" href="/decks?deck=${deck.id}" title="${deck.name}"
         draggable="true" data-drag-deck="${deck.id}">
        ${deckCover(deck, "deck-tile-cover")}
        <span class="deck-tile-label">
          <strong class="deck-tile-name">${deck.name}</strong>
          ${when(chemin !== "", html`<span class="muted deck-tile-meta">📁 ${chemin}</span>`)}
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
 * Ce que l'étage courant contient — ou ce que la recherche a trouvé.
 *
 * Les dossiers d'abord, les decks ensuite : c'est l'ordre de tous les
 * explorateurs, et il évite de chercher un dossier au milieu des fichiers.
 *
 * Pendant une recherche, plus de dossiers du tout : on cherche un deck, pas un
 * rangement, et la réponse traverse les étages. Chaque résultat dit alors d'où
 * il sort.
 */
function contenuHtml(state: DeckState): SafeHtml {
  const query = state.query.trim();
  const galerie = state.listView === "gallery";

  if (query !== "") {
    const trouvés = searchDecks(state, query);
    if (trouvés.length === 0) {
      return html`<div class="empty-state">
        <p class="empty-title">${t("Rien ici")}</p>
        <p class="muted">${t("Aucun deck ne porte ce nom.")}</p>
      </div>`;
    }
    return galerie
      ? html`<ul class="deck-tiles">
          ${trouvés.map((deck) => deckTile(state, deck, deckFolderPath(state, deck)))}
        </ul>`
      : html`<ul class="drive-list">${trouvés.map((deck) => deckDriveRow(state, deck))}</ul>`;
  }

  const dossiers = childFolders(state, state.folderId);
  const decks = decksIn(state, state.folderId);

  if (dossiers.length === 0 && decks.length === 0) {
    /**
     * Un dossier vide garde sa sortie.
     *
     * Sans elle, le seul chemin pour remonter serait le fil d'Ariane — et
     * l'écran qui n'a rien à montrer serait aussi celui qui donne le moins de
     * prise.
     */
    return html`${when(
      state.folderId !== null,
      galerie
        ? html`<ul class="deck-tiles">${parentTile(state)}</ul>`
        : html`<ul class="drive-list">${parentRow(state)}</ul>`,
    )}
    <div class="empty-state">
      <p class="empty-title">${state.folderId === null ? t("Rien ici") : t("Dossier vide")}</p>
      <p class="muted">
        ${state.folderId === null
          ? t("Construisez un deck pour commencer.")
          : t("Déplacez un deck ici, ou remontez d'un étage.")}
      </p>
    </div>`;
  }

  return galerie
    ? html`<ul class="deck-tiles">
        ${parentTile(state)} ${dossiers.map((folder) => folderTile(state, folder))}
        ${decks.map((deck) => deckTile(state, deck))}
      </ul>`
    : html`<ul class="drive-list">
        ${parentRow(state)} ${dossiers.map((folder) => folderRow(state, folder))}
        ${decks.map((deck) => deckDriveRow(state, deck))}
      </ul>`;
}

function listHtml(state: DeckState): SafeHtml {
  return html`<main class="decks-page">
    <div class="decks-manage-head">
      <h1>${t("Mes decks")}</h1>
      <p class="muted">
        ${t("Un deck se construit depuis votre collection : on n'y met que ce qu'on possède.")}
      </p>
    </div>

    ${breadcrumbHtml(state)} ${moveBannerHtml(state)}

    <div class="decks-toolbar">
      <label class="search">
        <span class="search-icon" aria-hidden="true">⌕</span>
        <input type="search" id="deck-search" value="${state.query}"
               placeholder="${t("Rechercher un deck…")}"
               aria-label="${t("Rechercher un deck")}" />
      </label>
      <div class="view-toggle" role="group" aria-label="${t("Affichage")}">
        <button type="button" class="icon-btn${state.listView === "list" ? " is-active" : ""}"
                data-list-view="list" title="${t("Liste")}" aria-label="${t("Vue liste")}"
                aria-pressed="${String(state.listView === "list")}"><span class="i-list" aria-hidden="true"></span></button>
        <button type="button" class="icon-btn${state.listView === "gallery" ? " is-active" : ""}"
                data-list-view="gallery" title="${t("Galerie")}" aria-label="${t("Vue galerie")}"
                aria-pressed="${String(state.listView === "gallery")}"><span class="i-grid" aria-hidden="true"></span></button>
      </div>
      <button type="button" class="btn" id="btn-new-folder">${t("Nouveau dossier")}</button>
      <button type="button" class="btn btn-primary decks-toolbar-build" id="btn-build">
        ${t("Construire un deck")}
      </button>
    </div>

    ${when(state.error, html`<p class="banner banner-err">${state.error}</p>`)}
    ${state.loading ? html`<p class="muted">${t("Chargement…")}</p>` : contenuHtml(state)}
    ${modalHtml(state)}
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
        <!--
          Aucun bouton d'enregistrement, et c'est voulu.
          Ange : « soit tu mets tout à jour soit tu mets rien à jour mais pas
          juste la moitié ». Les cartes partent à chaque « ± » ; le nom part
          quand la frappe se calme et quand le champ rend la main. La barre de
          comptes dit « Enregistré » dans les deux cas.

          Ni corbeille ici : jeter un deck est un geste sur l'objet, pas sur sa
          construction, et il vit sur la fiche. Deux endroits pour supprimer,
          c'est un de trop.
        -->
        <a class="btn" href="/decks?deck=${deck.id}">${t("← Fiche")}</a>
        <a class="btn" href="/decks">${t("Tous les decks")}</a>
      </div>
    </div>

    ${countsBar(deck, state)} ${deckStatusHtml(deck)}
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

/* ── La fiche du deck ─────────────────────────────────────────────────────
 *
 * **Ouvrir un deck le montre, il ne l'ouvre pas en écriture.** Reprise
 * d'ATEM-old (`renderDetail`) : la fiche liste les cartes comme la collection
 * les liste, et le crayon mène à l'atelier. Aucune commande n'écrit ici.
 */

type LigneDeFiche = { entry: DeckDetail["cards"][number]; zone: DeckZone; qty: number };

/**
 * Les lignes de la fiche, une par zone occupée.
 *
 * La même carte peut être au Main et au Side : c'est deux lignes, parce que
 * c'est deux places dans le deck. Sur « Tout », on les voit toutes les deux.
 */
function sheetEntries(deck: DeckDetail, zone: "all" | DeckZone, query: string): LigneDeFiche[] {
  const q = query.trim().toLowerCase();
  const lignes: LigneDeFiche[] = [];
  for (const entry of deck.cards) {
    if (q && !entry.name.toLowerCase().includes(q) && !String(entry.passcode).includes(q)) continue;
    for (const z of DECK_ZONES) {
      if ((zone === "all" || zone === z) && entry[z] > 0) lignes.push({ entry, zone: z, qty: entry[z] });
    }
  }
  return lignes;
}

function sheetRow({ entry, zone, qty }: LigneDeFiche): SafeHtml {
  return html`<li class="item">
    <div class="item-row">
      <button type="button" class="item-main js-open-card" data-pc="${String(entry.passcode)}">
        ${vignette(entry.imageUrlSmall, "thumb")}
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

function sheetTile({ entry, zone, qty }: LigneDeFiche): SafeHtml {
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
  const lignes = sheetEntries(deck, state.sheetZone, state.query);
  const total = deck.counts.main + deck.counts.extra + deck.counts.side;
  const dossier = state.folders.find((f) => f.id === deck.folderId);

  return html`<main class="decks-page">
    <div class="deck-sheet-top">
      <div class="deck-sheet-identity">
        <span class="deck-sheet-cover">${deckCover(deck, "deck-sheet-art")}</span>
        <div class="deck-sheet-titles">
          <h1>${deck.name}</h1>
          <p class="muted deck-sheet-place">
            ${when(dossier !== undefined, html`📁 ${dossier?.path.join(" / ") ?? ""}`)}
            ${when(dossier === undefined, html`📁 ${t("Racine")}`)}
          </p>
        </div>
      </div>
      <div class="deck-sheet-actions">
        <a class="btn" href="/decks">${t("Tous les decks")}</a>
        <a class="icon-btn" id="btn-edit-deck" href="/decks?deck=${deck.id}&atelier=1"
           title="${t("Modifier")}" aria-label="${t("Modifier")}">✏️</a>
        <button type="button" class="icon-btn btn-icon-danger" id="btn-delete"
                title="${t("Jeter ce deck")}" aria-label="${t("Jeter ce deck")}">🗑</button>
      </div>
    </div>

    ${countsBar(deck, state)} ${deckStatusHtml(deck)}
    ${when(state.error, html`<p class="banner banner-err">${state.error}</p>`)}

    <div class="decks-toolbar">
      <label class="search">
        <span class="search-icon" aria-hidden="true">⌕</span>
        <input type="search" id="deck-search" value="${state.query}"
               placeholder="${t("Rechercher une carte…")}"
               aria-label="${t("Rechercher une carte")}" />
      </label>
      <div class="view-toggle" role="group" aria-label="${t("Affichage")}">
        <button type="button" class="icon-btn${state.sheetView === "list" ? " is-active" : ""}"
                data-sheet-view="list" title="${t("Liste")}" aria-label="${t("Vue liste")}"
                aria-pressed="${String(state.sheetView === "list")}"><span class="i-list" aria-hidden="true"></span></button>
        <button type="button" class="icon-btn${state.sheetView === "gallery" ? " is-active" : ""}"
                data-sheet-view="gallery" title="${t("Galerie")}" aria-label="${t("Vue galerie")}"
                aria-pressed="${String(state.sheetView === "gallery")}"><span class="i-grid" aria-hidden="true"></span></button>
      </div>
    </div>

    <div class="zone-tabs" role="tablist">
      <button type="button" class="chip chip-zone${state.sheetZone === "all" ? " is-active" : ""}"
              data-sheet-zone="all" role="tab" aria-selected="${String(state.sheetZone === "all")}"
        >${t("Tout")} <span class="muted">${total}</span></button
      >
      ${DECK_ZONES.map(
        (zone) => html`<button type="button"
          class="chip chip-zone${state.sheetZone === zone ? " is-active" : ""}"
          data-sheet-zone="${zone}" role="tab" aria-selected="${String(state.sheetZone === zone)}"
          >${zoneIcon(zone)} ${ZONE_LABELS[zone]} <span class="muted">${deck.counts[zone]}</span></button
        >`,
      )}
    </div>

    ${lignes.length === 0
      ? html`<div class="empty-state">
          <p class="empty-title">${t("Aucune carte")}</p>
          <p class="muted">${t("Ouvrez l'atelier pour en poser.")}</p>
        </div>`
      : state.sheetView === "gallery"
        ? html`<div class="gallery" data-cols="6">${lignes.map(sheetTile)}</div>`
        : html`<ul class="item-list">${lignes.map(sheetRow)}</ul>`}
  </main>`;
}

/**
 * La carte ouverte depuis la fiche — sans rien pour écrire.
 *
 * L'atelier propose « +1 » et « −1 » sur la même fiche de carte ; ici il n'y a
 * que la carte. C'est ce qui fait de cet écran une lecture, et non un atelier
 * dont on aurait caché les boutons.
 */
function sheetCard(state: DeckState): SafeHtml {
  const carte = state.openedCard === null ? undefined : state.cardDetails.get(state.openedCard);
  if (!carte) return raw("");
  return cardSheetHtml({
    art: carte.imageUrl ?? carte.imageUrlSmall,
    title: carte.name,
    subtitle: `#${carte.passcode}`,
    card: carte,
  });
}

export function deckHtml(state: DeckState): SafeHtml {
  if (!state.opened) return listHtml(state);
  if (!state.editing) {
    return html`${sheetHtml(state, state.opened)}${when(state.openedCard !== null, sheetCard(state))}`;
  }
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
