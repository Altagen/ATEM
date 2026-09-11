/**
 * Le balisage de l'atelier de decks.
 *
 * Classes reprises de la maquette d'ATEM-old (`design/styles/pages/decks.css`),
 * dont la feuille attendait dans `design/staged/decks.css` depuis M0.
 *
 * **Deux panneaux** : la collection à gauche, où l'on puise ; les zones à
 * droite, où l'on pose. L'onglet de zone dit où vont les « +1 » — sauf pour un
 * monstre d'Extra Deck, qui y va toujours.
 */
import {
  DECK_ZONE_LIMITS, DECK_ZONES, checkDeckAdd, deckIsPlayable, isExtraDeckCard,
  parseBanlistStatus, type BanlistStatus, type DeckZone,
} from "@atem/shared";
import { t } from "../../platform/i18n/index.js";
import { html, raw, when, type SafeHtml } from "../../platform/ui.js";
import { inDeck, type DeckDetail, type DeckState, type DeckSummary, type OwnedCard } from "./state.js";

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

const ZONE_LABELS: Record<DeckZone, string> = {
  main: "Main",
  extra: "Extra",
  side: "Side",
};

/** La pastille de banlist — rien du tout quand la carte est illimitée. */
function banBadge(banlistTcg: string | null): SafeHtml {
  const statut = parseBanlistStatus(banlistTcg);
  if (statut === "unlimited") return raw("");
  return html`<span class="ban-badge ban-badge-${statut === "semi_limited" ? "semi" : statut}"
    >${t(BAN_LABELS[statut])}</span
  >`;
}

const vignette = (url: string | null, nom: string): SafeHtml =>
  url
    ? html`<img class="thumb thumb-sm" src="${url}" alt="${nom}" loading="lazy" decoding="async" />`
    : raw(`<div class="thumb-empty thumb-sm">?</div>`);

/* ── La liste des decks ────────────────────────────────────────────────── */

function deckRow(deck: DeckSummary): SafeHtml {
  const jouable = deckIsPlayable(deck.counts, deck.missing);
  return html`<li class="drive-row">
    <a class="drive-main" href="/decks?deck=${deck.id}">
      <span class="drive-ico" aria-hidden="true">🃏</span>
      <span class="drive-text">
        <strong class="drive-name">${deck.name}</strong>
        <span class="drive-meta muted">
          ${t("Main {main} · Extra {extra} · Side {side}", {
            main: deck.counts.main, extra: deck.counts.extra, side: deck.counts.side,
          })}
        </span>
      </span>
      ${jouable
        ? html`<span class="zone-pill deck-ready">${t("Prêt")}</span>`
        : html`<span class="zone-pill deck-unready"
            >${deck.missing > 0
              ? t("{n} à retrouver", { n: deck.missing })
              : t("Incomplet")}</span
          >`}
    </a>
  </li>`;
}

function listHtml(state: DeckState): SafeHtml {
  return html`
    <div class="scan-head">
      <div>
        <h1 class="page-title">${t("Mes decks")}</h1>
        <p class="muted">
          ${t("Un deck se construit depuis votre collection : on n'y met que ce qu'on possède.")}
        </p>
      </div>
      <button type="button" class="btn btn-hero scan-new" id="deck-new">${t("Nouveau deck")}</button>
    </div>

    ${when(state.error, html`<p class="scan-note warn">${state.error}</p>`)}

    <p class="scan-count muted">${t("{n} deck(s)", { n: state.decks.length })}</p>
    ${state.loading
      ? raw(`<p class="web-loading muted">${t("Chargement…")}</p>`)
      : state.decks.length === 0
        ? html`<p class="scan-draft-empty muted">
            ${t("Aucun deck pour l'instant. Créez-en un, puis piochez dans votre collection.")}
          </p>`
        : html`<ul class="drive-list">${state.decks.map(deckRow)}</ul>`}
  `;
}

/* ── L'atelier ─────────────────────────────────────────────────────────── */

/** Une carte de la collection, avec ce qu'elle pèse déjà dans le deck. */
function collectionRow(card: OwnedCard): SafeHtml {
  const déjà = inDeck(card.passcode);
  const issue = checkDeckAdd({ banlistTcg: card.banlistTcg, owned: card.owned, inDeck: déjà });

  return html`<li class="deck-coll-tile">
    <button type="button" class="zone-edit-main js-add" data-pc="${String(card.passcode)}"
            ${issue.canAdd ? raw("") : raw("disabled")}
            title="${issue.canAdd ? t("Ajouter au deck") : t(REFUS_LABELS[issue.blockedBy ?? "max_copies"] ?? "Ajout impossible.")}">
      ${vignette(card.imageUrlSmall, card.name)}
      <span class="zone-edit-text">
        <strong>${card.name}</strong>
        <span class="muted in-deck-qty-label">
          ${t("{owned} en collection", { owned: card.owned })}${déjà > 0
            ? t(" · {n} au deck", { n: déjà })
            : ""}
        </span>
        ${banBadge(card.banlistTcg)}
      </span>
    </button>
  </li>`;
}

/** Une ligne du deck, dans la zone affichée. */
function zoneRow(entry: DeckDetail["cards"][number], zone: DeckZone): SafeHtml {
  const quantité = entry[zone];
  return html`<li class="zone-edit-row${entry.missing > 0 ? " deck-line-forced" : ""}">
    <span class="zone-edit-main">
      ${vignette(entry.imageUrlSmall, entry.name)}
      <span class="zone-edit-text">
        <strong>${entry.name}</strong>
        ${when(
          entry.missing > 0,
          html`<span class="muted"
            >${t("{n} à retrouver — {owned} en collection", {
              n: entry.missing, owned: entry.owned,
            })}</span
          >`,
        )}
        ${banBadge(entry.banlistTcg)}
      </span>
    </span>
    <div class="deck-stepper zone-qty" role="group" aria-label="${entry.name}">
      <button type="button" class="btn-qty js-zone" data-pc="${String(entry.passcode)}" data-d="-1"
              aria-label="${t("Retirer un exemplaire")}">−</button>
      <span class="deck-stepper-qty is-in-deck">×${quantité}</span>
      <button type="button" class="btn-qty js-zone" data-pc="${String(entry.passcode)}" data-d="1"
              aria-label="${t("Ajouter un exemplaire")}">+</button>
    </div>
  </li>`;
}

function workshopHtml(state: DeckState, deck: DeckDetail): SafeHtml {
  const zone = state.zone;
  const dansLaZone = deck.cards.filter((entry) => entry[zone] > 0);
  const { min, max } = DECK_ZONE_LIMITS[zone];
  const jouable = deckIsPlayable(deck.counts, deck.missing);

  return html`
    <div class="scan-head">
      <div>
        <h1 class="page-title">${deck.name}</h1>
        <p class="muted">
          ${jouable
            ? t("Prêt à jouer.")
            : deck.missing > 0
              ? t("{n} carte(s) à retrouver avant de pouvoir le jouer.", { n: deck.missing })
              : t("Main {main}/{min} — complétez-le pour pouvoir le jouer.", {
                  main: deck.counts.main, min: DECK_ZONE_LIMITS.main.min,
                })}
        </p>
      </div>
      <a class="btn scan-new" href="/decks">${t("Tous les decks")}</a>
    </div>

    ${when(state.error, html`<p class="scan-note warn">${state.error}</p>`)}

    <div class="scan-actions">
      <button type="button" class="btn" id="deck-rename">${t("Renommer")}</button>
      <button type="button" class="btn scan-trash" id="deck-delete">${t("Jeter ce deck")}</button>
    </div>

    <div class="deck-panel-switch" role="group" aria-label="${t("Panneau")}">
      ${(["collection", "zones"] as const).map(
        (panneau) => html`<button type="button"
          class="chip${state.panel === panneau ? " is-active" : ""}"
          data-panel="${panneau}" aria-pressed="${String(state.panel === panneau)}"
          >${panneau === "collection" ? t("Votre collection") : t("Le deck")}</button
        >`,
      )}
    </div>

    <div class="deck-edit-layout is-panneau-${state.panel === "collection" ? "coll" : "zone"}">
      <section class="deck-edit-collection">
        <h2 class="titre-section">${t("Votre collection")}</h2>
        <div class="add-field">
          <input type="search" id="deck-search" class="add-input"
                 placeholder="${t("Rechercher une carte…")}"
                 aria-label="${t("Rechercher dans la collection")}" value="${state.query}" />
        </div>
        ${state.collection.length === 0
          ? html`<p class="zone-edit-empty muted">${t("Rien à piocher ici.")}</p>`
          : html`<ul class="deck-edit-coll-list">
              ${state.collection.map(collectionRow)}
            </ul>`}
      </section>

      <section class="deck-edit-zones">
        <div class="zone-tabs" role="tablist">
          ${DECK_ZONES.map(
            (z) => html`<button type="button"
              class="chip chip-zone${state.zone === z ? " is-active" : ""}"
              data-zone="${z}" role="tab" aria-selected="${String(state.zone === z)}"
              >${ZONE_LABELS[z]} <span class="muted">${deck.counts[z]}</span></button
            >`,
          )}
        </div>
        <p class="muted zone-hint">
          ${t("L'onglet dit où vont les « + ». Les monstres d'Extra Deck y vont toujours.")}
        </p>
        <p class="muted deck-zone-summary">
          ${t("{n} carte(s) · {min} à {max}", { n: deck.counts[zone], min, max })}
        </p>
        ${dansLaZone.length === 0
          ? html`<p class="zone-edit-empty muted">${t("Zone vide")}</p>`
          : html`<ul class="zone-edit-list">${dansLaZone.map((entry) => zoneRow(entry, zone))}</ul>`}
      </section>
    </div>
  `;
}

/** Les raisons de refus, dans les mots de l'écran. Mêmes clés que le serveur. */
const REFUS_LABELS: Record<string, string> = {
  forbidden: "Cette carte est interdite par la banlist.",
  banlist: "La banlist n'en autorise pas autant.",
  not_owned: "Vous ne possédez pas assez d'exemplaires de cette carte.",
  max_copies: "Un deck ne porte pas plus de 3 exemplaires d'une carte.",
};

export function deckHtml(state: DeckState): SafeHtml {
  return html`<div class="scan-page deck-detail-page">
    ${state.opened ? workshopHtml(state, state.opened) : listHtml(state)}
  </div>`;
}

/** La zone où une carte doit aller, quelle que soit celle qu'on regarde. */
export function zoneFor(card: { type: string | null; frameType: string | null }, courante: DeckZone): DeckZone {
  if (courante === "side") return "side";
  return isExtraDeckCard(card) ? "extra" : "main";
}
