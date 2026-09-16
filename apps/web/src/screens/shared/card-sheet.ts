/**
 * The full-size card sheet, shared by the screens that show it.
 *
 * The collection and the deck workshop display the same thing — the artwork
 * large, the characteristics, the effect — and differ in what can be done from
 * there: removing a copy on one side, placing it in a zone on the other.
 * ATEM-old had two distinct functions repeating the same markup; there were
 * therefore two places to fix an alignment.
 *
 * The content specific to each screen goes through `headActions` and `extra`.
 * Everything else is here, and alignment is settled once.
 */
import { t } from "../../platform/i18n/index.js";
import {
  translateAttribute, translateLinkMarker, translateRace, translateType,
  CATALOGUE,
} from "../../platform/ygo-labels.js";
import { html, raw, when, type SafeHtml } from "../../platform/ui.js";
import type { CardDetail } from "../../platform/api.js";

/** A “label / value” grid, the pattern of the whole sheet. */
export const detailGrid = (entries: [string, string][]): SafeHtml =>
  html`<dl class="detail-grid">
    ${entries.map(([term, value]) => html`<div><dt>${term}</dt><dd>${value}</dd></div>`)}
  </dl>`;

/**
 * A card's characteristics, in the order they are read.
 *
 * A Link monster has neither level nor defence: the row changes nature rather
 * than displaying two dashes. It is a different card, not an incomplete one.
 */
function cardDetailRows(card: CardDetail): [string, string][] {
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
 * The compass of a Link monster's markers.
 *
 * Eight cells around a centre, the arrows lit where the monster points. A list
 * of names — “Top-Left, Bottom” — asks the reader to rebuild the figure in
 * their head; the figure itself just reads.
 */
function linkCompassHtml(markers: string[] | null, linkValue: number | null): SafeHtml {
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
  /** The full-size artwork, when the catalogue has it. */
  art: string | null | undefined;
  title: string;
  subtitle: string;
  /** What can be done from the header: “−1” here, nothing there. */
  headActions?: SafeHtml;
  card: CardDetail | null;
  /** The screen-specific block, below the characteristics. */
  extra?: SafeHtml;
  /** What is said **before** the characteristics — a warning. */
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
