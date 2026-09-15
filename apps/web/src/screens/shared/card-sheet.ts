/**
 * La fiche de carte en grand, partagée par les écrans qui la montrent.
 *
 * La collection et l'atelier de decks affichent la même chose — l'illustration
 * en grand, les caractéristiques, l'effet — et diffèrent par ce qu'on peut
 * faire depuis là : retirer un exemplaire d'un côté, le poser dans une zone de
 * l'autre. ATEM-old avait deux fonctions distinctes qui répétaient le même
 * balisage ; il y avait donc deux endroits où corriger un alignement.
 *
 * Le contenu propre à chaque écran passe par `headActions` et `extra`. Tout le
 * reste est ici, et l'alignement se règle une fois.
 */
import { t } from "../../platform/i18n/index.js";
import {
  translateAttribute, translateLinkMarker, translateRace, translateType,
  CATALOGUE,
} from "../../platform/ygo-labels.js";
import { html, raw, when, type SafeHtml } from "../../platform/ui.js";
import type { CardDetail } from "../../platform/api.js";

/** Une grille « intitulé / valeur », le motif de toute la fiche. */
export const detailGrid = (entries: [string, string][]): SafeHtml =>
  html`<dl class="detail-grid">
    ${entries.map(([term, value]) => html`<div><dt>${term}</dt><dd>${value}</dd></div>`)}
  </dl>`;

/**
 * Les caractéristiques d'une carte, dans l'ordre où on les lit.
 *
 * Un monstre Lien n'a ni niveau ni défense : la ligne change de nature plutôt
 * que d'afficher deux tirets. C'est une carte différente, pas une carte
 * incomplète.
 */
export function cardDetailRows(card: CardDetail): [string, string][] {
  const isSpellTrap = card.type === CATALOGUE.spellCard || card.type === CATALOGUE.trapCard;
  return [
    [t("Type"), translateType(card.type)],
    [isSpellTrap ? t("Property") : t("Monster type"), translateRace(card.race, card.type) || "—"],
    [t("Attribute"), translateAttribute(card.attribute) || "—"],
    card.linkValue !== null
      ? [t("Link"), String(card.linkValue)]
      : [t("Level"), card.level === null ? "—" : String(card.level)],
    [
      card.linkValue !== null ? t("ATK") : t("ATK / DEF"),
      card.linkValue !== null
        ? String(card.atk ?? "—")
        : `${card.atk ?? "—"} / ${card.def ?? "—"}`,
    ],
    [t("Archetype"), card.archetype ?? "—"],
    [t("Passcode"), `#${card.passcode}`],
  ];
}

/**
 * La rose des marqueurs d'un monstre Lien.
 *
 * Huit cases autour d'un centre, les flèches allumées là où le monstre pointe.
 * Une liste de noms — « Haut-Gauche, Bas » — demande de reconstruire la figure
 * dans sa tête ; la figure, elle, se lit.
 */
export function linkCompassHtml(markers: string[] | null, linkValue: number | null): SafeHtml {
  if (!markers?.length) return raw("");
  const cells = [
    "Top-Left", "Top", "Top-Right",
    "Left", null, "Right",
    "Bottom-Left", "Bottom", "Bottom-Right",
  ];
  const arrows: Record<string, string> = {
    "Top-Left": "↖", Top: "↑", "Top-Right": "↗",
    Left: "←", Right: "→",
    "Bottom-Left": "↙", Bottom: "↓", "Bottom-Right": "↘",
  };
  return html`<div class="link-compass-block">
    <h3>${t("Link markers")}</h3>
    <div class="link-compass" role="img"
         aria-label="${markers.map(translateLinkMarker).join(", ")}">
      ${cells.map((cell) =>
        cell === null
          ? html`<span class="link-center">${linkValue ?? "—"}</span>`
          : html`<span class="link-arrow${markers.includes(cell) ? " is-on" : ""}"
              aria-hidden="true">${arrows[cell]}</span>`,
      )}
    </div>
  </div>`;
}

export type CardSheetOptions = {
  /** L'illustration en grand, quand le catalogue l'a. */
  art: string | null | undefined;
  title: string;
  subtitle: string;
  /** Ce qu'on peut faire depuis l'en-tête : « −1 » ici, rien là. */
  headActions?: SafeHtml;
  card: CardDetail | null;
  /** Le bloc propre à l'écran, sous les caractéristiques. */
  extra?: SafeHtml;
  /** Ce qui se dit **avant** les caractéristiques — un avertissement. */
  notice?: SafeHtml;
};

export function cardSheetHtml(options: CardSheetOptions): SafeHtml {
  const { art, card } = options;
  return html`<div class="inspect-backdrop" id="inspect-backdrop"></div>
  <div class="inspect-panel" id="inspect-panel" role="dialog" aria-modal="true">
    <button type="button" class="inspect-close icon-btn" id="inspect-close"
            aria-label="${t("Close")}">✕</button>
    <div class="inspect-layout">
      <div class="inspect-art-col">
        ${art
          ? html`<img class="inspect-art" src="${art}" alt="" />`
          : raw(`<div class="inspect-art inspect-art-empty">?</div>`)}
      </div>
      <div class="inspect-info-col">
        <header class="inspect-info-head">
          <h2>${options.title}</h2>
          <p class="inspect-sub muted">${options.subtitle}</p>
          ${when(options.headActions, options.headActions ?? raw(""))}
        </header>
        <div class="inspect-info-body">
          ${when(options.notice, options.notice ?? raw(""))}
          ${when(Boolean(card), card ? detailGrid(cardDetailRows(card)) : raw(""))}
          ${when(
            Boolean(card?.desc),
            html`<div class="effect"><h3>${t("Effect")}</h3><p>${card?.desc}</p></div>`,
          )}
          ${linkCompassHtml(card?.linkMarkers ?? null, card?.linkValue ?? null)}
          ${when(options.extra, options.extra ?? raw(""))}
        </div>
      </div>
    </div>
  </div>`;
}
