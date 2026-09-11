/**
 * Le rendu de l'écran de collection.
 *
 * Balisage repris de `apps/web/src/collection/vue.ts` d'ATEM-old, qui fait
 * autorité — la maquette `design/pages/collection.html` est une version
 * antérieure, avec un autre jeu de classes.
 *
 * Ce qui n'est **pas** repris, et pourquoi : le champ « passcode » de la barre
 * avancée (notre API d'ajout ne le prend pas), le lien vers les scanlistes
 * (l'écran n'existe pas encore), et les notes de carte (pas d'endpoint). Poser
 * un contrôle qui ne fait rien est pire que de ne pas le poser.
 */
import { t } from "../../platform/i18n/index.js";
import { html, raw, when, type SafeHtml } from "../../platform/ui.js";
import {
  translateAttribute, translateFrameType, translateLinkMarker, translateRace, translateType,
} from "../../platform/ygo-labels.js";
import type { CollectionItem, Facets, ViewState } from "./state.js";


/** La nature d'une carte, telle que l'écran la regroupe et la filtre. */
function kindOf(item: CollectionItem): "monster" | "spell" | "trap" | "unresolved" {
  const type = item.card?.type ?? "";
  if (!item.card) return "unresolved";
  if (type.includes("Spell")) return "spell";
  if (type.includes("Trap")) return "trap";
  return "monster";
}

function groupTitle(item: CollectionItem): string {
  const kind = kindOf(item);
  if (kind === "spell") return t("Magie");
  if (kind === "trap") return t("Piège");
  if (kind === "unresolved") return t("À identifier");
  return translateRace(item.card?.race, item.card?.type) || "Type inconnu";
}

/**
 * Découpe une liste **déjà triée** en groupes consécutifs de même titre.
 *
 * Ce n'est pas un regroupement global : le groupement suit toujours l'ordre de
 * tri choisi, et un même titre peut réapparaître si le tri l'a séparé. C'est
 * délibéré — trier par quantité puis regrouper par type produirait sinon un
 * ordre que rien n'explique.
 */
/**
 * Découpe une liste **déjà triée** en groupes consécutifs de même titre.
 *
 * Sans regroupement, la liste sort d'un bloc, dans l'ordre du tri et rien
 * d'autre : c'est le comportement par défaut d'ATEM-old, et le bon. Découper
 * par famille impose une seconde clé d'ordre par-dessus celle qu'on a choisie,
 * et l'on ne retrouve plus ce qu'on cherche.
 */
export function group(
  items: CollectionItem[],
  byMonsterType: boolean,
): { title: string | null; items: CollectionItem[] }[] {
  if (!byMonsterType) return items.length > 0 ? [{ title: null, items }] : [];

  const out: { title: string | null; items: CollectionItem[] }[] = [];
  for (const item of items) {
    const title = groupTitle(item);
    const last = out.at(-1);
    if (last?.title === title) last.items.push(item);
    else out.push({ title, items: [item] });
  }
  return out;
}

const metaBits = (item: CollectionItem): SafeHtml => {
  const card = item.card;
  if (!card) return raw("");
  const bits: SafeHtml[] = [];

  if (card.type) bits.push(html`<span class="meta-bit">${translateType(card.type)}</span>`);
  if (card.attribute) {
    bits.push(
      html`<span class="meta-bit"><img class="meta-ico attr"
        src="/assets/icons/attr/${iconFile(card.attribute)}.png" alt="" width="16" height="16"
        loading="lazy" />${translateAttribute(card.attribute)}</span>`,
    );
  }
  if (card.linkValue !== null) {
    bits.push(html`<span class="meta-bit">${t("Lien {n}", { n: card.linkValue })}</span>`);
  } else if (card.level !== null) {
    const isXyz = (card.type ?? "").includes("XYZ");
    bits.push(
      html`<span class="meta-bit">${levelBadge(isXyz ? "rank" : "level")}${isXyz ? t("Rang {n}", { n: card.level }) : t("Niv. {n}", { n: card.level })}</span>`,
    );
  }
  if (card.atk !== null || card.def !== null) {
    bits.push(html`<span class="meta-bit">${card.atk ?? "?"}/${card.def ?? "?"}</span>`);
  }
  if (card.race) {
    const isSpellTrap = card.type === "Spell Card" || card.type === "Trap Card";
    bits.push(
      html`<span class="meta-bit"><img class="meta-ico race"
        src="/assets/icons/${isSpellTrap ? "st" : "race"}/${iconFile(card.race)}.png" alt=""
        width="14" height="14" loading="lazy" />${translateRace(card.race, card.type)}</span>`,
    );
  }
  return html`<span class="stats-line-rich">${bits}</span>`;
};

function listItem(item: CollectionItem): SafeHtml {
  const art = item.card?.imageUrlSmall ?? item.card?.imageUrl;
  return html`<li class="item">
    <div class="item-row">
      <button type="button" class="item-main js-open" data-id="${item.id}">
        ${art
          ? html`<img class="thumb" src="${art}" alt="" loading="lazy" decoding="async" />`
          : raw(`<div class="thumb-empty">?</div>`)}
        <div class="item-text">
          <strong>${item.card?.name ?? t("Carte non identifiée")}</strong>
          <code>${item.setCode}</code>
          <div class="item-meta">
            <span>×${item.quantity}</span>
            ${when(item.print.rarity, html`<span>${item.print.rarity}</span>`)}
            ${when(
              item.print.resolveStatus !== "resolved",
              raw(`<span class="warn">${t("en attente")}</span>`),
            )}
            ${when(item.isFavorite, raw(`<span class="ok-tag fav-tag">★</span>`))}
          </div>
          <div class="stats-line muted">${metaBits(item)}</div>
        </div>
      </button>
      <div class="item-actions">
        <button type="button" class="btn-qty js-fav${item.isFavorite ? " is-fav" : ""}"
                data-id="${item.id}" title="${t("Favori")}"
                aria-label="${t("Mettre en favori")}" aria-pressed="${String(item.isFavorite)}">★</button>
        <button type="button" class="btn-qty js-delta" data-id="${item.id}" data-d="1"
                aria-label="${t("Ajouter un exemplaire")}">+</button>
        <button type="button" class="btn-qty btn-qty-danger js-delta" data-id="${item.id}" data-d="-1"
                aria-label="${t("Retirer un exemplaire")}">−</button>
      </div>
    </div>
  </li>`;
}

function tile(item: CollectionItem): SafeHtml {
  const art = item.card?.imageUrlSmall ?? item.card?.imageUrl;
  // Pas de « +1 » ici : en galerie, on ouvre la carte pour agir. C'est le choix
  // d'ATEM-old, et il tient — la tuile est une vignette, pas un formulaire.
  return html`<button type="button" class="tile js-open" data-id="${item.id}">
    <div class="tile-art">
      ${art
        ? html`<img src="${art}" alt="" loading="lazy" decoding="async" />`
        : raw(`<div class="tile-art-empty">?</div>`)}
      <span class="tile-qty">×${item.quantity}</span>
      ${when(item.isFavorite, raw(`<span class="tile-star" title="${t("Favori")}">★</span>`))}
    </div>
    <div class="tile-body">
      <strong class="tile-name">${item.card?.name ?? t("Carte non identifiée")}</strong>
      <code>${item.setCode}</code>
    </div>
  </button>`;
}

export function contentHtml(state: ViewState): SafeHtml {
  if (state.loading) return raw(`<p class="web-loading muted">${t("Chargement…")}</p>`);

  if (state.items.length === 0) {
    const filtered = state.total === 0 && hasActiveFilters(state);
    return html`<div class="empty-state">
      <p class="empty-title">${filtered ? t("Aucun résultat") : t("Aucune carte")}</p>
      <p class="muted">
        ${filtered
          ? "Modifiez les filtres."
          : t("Saisissez le code en bas de la carte, puis appuyez sur +.")}
      </p>
    </div>`;
  }

  const groups = group(state.items, state.groupByMonster);

  if (state.view === "gallery") {
    return html`<div class="gallery" data-cols="${state.cols}" id="view-gallery">
      ${groups.flatMap((g) => [
        when(
          g.title !== null,
          html`<div class="group-header group-header-gallery"><span>${g.title}</span><span>${g.items.length}</span></div>`,
        ),
        ...g.items.map(tile),
      ])}
    </div>`;
  }

  return html`<ul class="item-list" id="view-list">
    ${groups.flatMap((g) => [
      when(
        g.title !== null,
        html`<li class="group-header" role="presentation"><span>${g.title}</span><span>${g.items.length}</span></li>`,
      ),
      ...g.items.map(listItem),
    ])}
  </ul>`;
}

function hasActiveFilters(state: ViewState): boolean {
  return Boolean(
    state.query ||
      state.kind ||
      state.attributes.length ||
      state.races.length ||
      state.frameTypes.length ||
      state.properties.length ||
      state.levels.length ||
      state.rarity ||
      state.language ||
      state.favoritesOnly ||
      state.unresolvedOnly,
  );
}

/**
 * Le nom de fichier d'une icône suit la valeur anglaise, espaces en tirets :
 * `Sea Serpent` → `Sea-Serpent.png`. C'est la convention des ressources
 * reprises d'ATEM-old ; s'en écarter casserait l'affichage en silence.
 */
const iconFile = (value: string) => value.replace(/\s+/g, "-");

const attrIcon = (value: string): SafeHtml =>
  html`<img class="ygo-ico attr-ico-img" src="/assets/icons/attr/${iconFile(value)}.png"
       alt="" width="18" height="18" loading="lazy" />`;

const raceIcon = (value: string): SafeHtml =>
  html`<img src="/assets/icons/race/${iconFile(value)}.png" alt=""
       width="16" height="16" loading="lazy" />`;

const propertyIcon = (value: string): SafeHtml =>
  html`<img class="st-ico-img" src="/assets/icons/st/${iconFile(value)}.png" alt=""
       width="18" height="18" loading="lazy" />`;

const levelBadge = (kind: "level" | "rank"): SafeHtml =>
  html`<span class="star-badge star-badge-${kind}"><img
       src="/assets/icons/level/${kind === "rank" ? "rank" : "level"}.svg" alt=""
       width="12" height="12" /></span>`;

/**
 * Une puce de filtre.
 *
 * L'attribut de données est passé **en deux morceaux**, nom et valeur, jamais
 * comme un fragment d'HTML déjà écrit. La version précédente interpolait une
 * chaîne d'attributs par `raw()`, et les appelants la construisaient au gabarit
 * ordinaire : une rareté vaut ce que le catalogue distant a écrit, et une
 * valeur comme `" onmouseover="…` fermait l'attribut pour en ouvrir un autre.
 *
 * C'est exactement l'échappée de secours que `platform/ui.ts` dit ne pas avoir.
 * Elle avait été rouverte ici.
 */
const chip = (
  active: boolean,
  attribute: string,
  value: string,
  label: string | SafeHtml,
  extra = "",
): SafeHtml =>
  html`<button type="button"
    class="chip${extra ? ` ${extra}` : ""}${active ? " is-active" : ""}"
    ${raw(attribute)}="${value}">${label}</button>`;

export function filterPanelHtml(state: ViewState, facets: Facets): SafeHtml {
  const kinds: [string, string][] = [
    ["", t("Toutes")],
    ["monster", t("Monstre")],
    ["spell", t("Magie")],
    ["trap", t("Piège")],
    ["unresolved", t("À identifier")],
  ];

  return html`<div class="filter-backdrop" id="filter-backdrop" hidden></div>
  <div class="filter-panel" id="filter-panel" role="dialog" aria-modal="true"
       aria-label="${t("Trier et filtrer")}" hidden>
    <div class="filter-panel-head">
      <h2>Trier &amp; filtrer</h2>
      <button type="button" class="icon-btn" id="filter-panel-close" aria-label="${t("Fermer")}">✕</button>
    </div>

    <div class="filter-panel-body">
      <section class="filter-block">
        <h3 class="filter-block-title">${t("Trier")}</h3>
        <div class="filter-row">
          <label class="menu-field grow">
            <span>${t("Ordre")}</span>
            <select id="sort">
              ${[
                ["recent", t("Ajout récent")],
                ["name", t("Nom")],
                ["quantity", t("Quantité")],
                ["setCode", t("Set code")],
              ].map(
                ([value, label]) =>
                  html`<option value="${value}"${state.sort === value ? raw(" selected") : raw("")}>${label}</option>`,
              )}
            </select>
          </label>
          <label class="menu-field">
            <span>${t("Sens")}</span>
            <select id="sort-dir">
              ${[["desc", t("Décroissant")], ["asc", t("Croissant")]].map(
                ([value, label]) =>
                  html`<option value="${value}"${state.sortDir === value ? raw(" selected") : raw("")}>${label}</option>`,
              )}
            </select>
          </label>
        </div>
        <div class="filter-row">
          <label class="menu-field">
            <span>${t("Colonnes")}</span>
            <select id="cols">
              ${["auto", "2", "3", "4", "5", "6"].map(
                (value) =>
                  html`<option value="${value}"${state.cols === value ? raw(" selected") : raw("")}>${value}</option>`,
              )}
            </select>
          </label>
          <label class="menu-field">
            <span>${t("Densité")}</span>
            <select id="density">
              ${[["comfort", t("Confort")], ["compact", t("Compact")]].map(
                ([value, label]) =>
                  html`<option value="${value}"${state.density === value ? raw(" selected") : raw("")}>${label}</option>`,
              )}
            </select>
          </label>
        </div>
        <label class="menu-check">
          <input type="checkbox" id="group-monster"${state.groupByMonster ? raw(" checked") : raw("")} />
          ${t("Regrouper les monstres par type")}
        </label>
      </section>

      <section class="filter-block">
        <h3 class="filter-block-title">${t("Catégorie")}</h3>
        <div class="chip-row">
          ${kinds.map(([value, label]) =>
            chip(state.kind === value, "data-filter-kind", value, label),
          )}
        </div>
      </section>

      ${when(
        facets.attributes.length > 0,
        html`<section class="filter-block">
          <h3 class="filter-block-title">${t("Attribut")}</h3>
          <div class="chip-row">
            ${facets.attributes.map((value) =>
              chip(
                state.attributes.includes(value),
                "data-filter-attr", value,
                html`${attrIcon(value)}${translateAttribute(value)}`,
                "chip-attr",
              ),
            )}
          </div>
        </section>`,
      )}

      ${when(
        facets.frameTypes.length > 0,
        html`<section class="filter-block">
          <h3 class="filter-block-title">${t("Type d'invocation")}</h3>
          <div class="chip-row">
            ${facets.frameTypes.map((value) =>
              chip(
                state.frameTypes.includes(value),
                "data-filter-frame", value,
                translateFrameType(value),
              ),
            )}
          </div>
        </section>`,
      )}

      ${when(
        facets.properties.length > 0,
        html`<section class="filter-block">
          <div class="filter-block-head">
            <h3 class="filter-block-title"/h3>
            <button type="button" class="help-q" id="btn-help-st"
                    aria-expanded="false" aria-controls="help-st-hint">
              <span class="help-q-mark" aria-hidden="true">?</span>
              <span class="help-q-text">${t("Aide")}</span>
            </button>
          </div>
          <div class="chip-row">
            ${facets.properties.map((value) =>
              chip(
                state.properties.includes(value),
                "data-filter-st", value,
                html`${propertyIcon(value)}${translateRace(value, "Spell Card")}`,
                "chip-st",
              ),
            )}
          </div>
          <p class="filter-hint muted" id="help-st-hint" hidden>
            ${t("L'API range le type d'un monstre et la propriété d'une Magie ou d'un Piège dans le même champ. Un Piège « Normale » n'est donc pas un monstre Normal : ces deux listes sont séparées pour cette raison.")}
          </p>
        </section>`,
      )}

      ${when(
        facets.races.length > 0,
        html`<section class="filter-block">
          <h3 class="filter-block-title">${t("Type de monstre")}</h3>
          <div class="chip-row chip-row-races">
            ${facets.races.map((value) =>
              chip(
                state.races.includes(value),
                "data-filter-race", value,
                html`${raceIcon(value)}${translateRace(value)}`,
                "chip-race",
              ),
            )}
          </div>
        </section>`,
      )}

      <section class="filter-block">
        <h3 class="filter-block-title">${t("Niveau")}</h3>
        <div class="chip-row">
          ${Array.from({ length: 12 }, (_, i) => String(i + 1)).map((level) =>
            chip(
              state.levels.includes(level),
              "data-filter-level", level,
              level,
              "chip-level",
            ),
          )}
        </div>
      </section>

      <section class="filter-block">
        <h3 class="filter-block-title">${t("Rang Xyz")}</h3>
        <div class="chip-row">
          ${Array.from({ length: 12 }, (_, i) => String(i + 1)).map((rank) =>
            chip(
              state.ranks.includes(rank),
              "data-filter-rank",
              rank,
              html`${levelBadge("rank")}${rank}`,
              "chip-level chip-rank",
            ),
          )}
        </div>
      </section>

      <section class="filter-block">
        <h3 class="filter-block-title">${t("Valeur de Lien")}</h3>
        <div class="chip-row">
          ${Array.from({ length: 6 }, (_, i) => String(i + 1)).map((value) =>
            chip(state.links.includes(value), "data-filter-link", value, `Lien ${value}`),
          )}
        </div>
      </section>

      ${when(
        facets.rarities.length > 0,
        html`<section class="filter-block">
          <h3 class="filter-block-title"/h3>
          <div class="chip-row">
            ${facets.rarities.map((value) =>
              chip(state.rarity === value, "data-filter-rarity", value, value),
            )}
          </div>
        </section>`,
      )}

      ${when(
        facets.languages.length > 1,
        html`<section class="filter-block">
          <h3 class="filter-block-title">${t("Langue de l'exemplaire")}</h3>
          <div class="chip-row">
            ${facets.languages.map((value) =>
              chip(state.language === value, "data-filter-lang", value, value.toUpperCase()),
            )}
          </div>
        </section>`,
      )}

      <section class="filter-block">
        <div class="chip-row">
          ${chip(state.favoritesOnly, "data-filter-fav", "1", "★ Favoris")}
          ${chip(state.unresolvedOnly, "data-filter-unresolved", "1", "À identifier")}
        </div>
      </section>
    </div>

    <div class="filter-panel-foot">
      <button type="button" class="btn" id="btn-clear-filters">${t("Réinitialiser")}</button>
      <div class="filter-foot-actions">
        <button type="button" class="btn btn-primary" id="filter-panel-done">${t("OK")}</button>
      </div>
    </div>
  </div>`;
}

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
    <h3>${t("Marqueurs de Lien")}</h3>
    <div class="link-compass" role="img"
         aria-label="${markers.map(translateLinkMarker).join(", ")}">
      ${cells.map((cell) =>
        cell === null
          ? html`<span class="link-center">${linkValue ?? "—"}</span>`
          : html`<span class="link-arrow${markers.includes(cell) ? " is-on" : ""}" aria-hidden="true">${arrows[cell]}</span>`,
      )}
    </div>
  </div>`;
}

/** La fiche plein écran d'une carte ouverte. */
export function inspectHtml(item: CollectionItem): SafeHtml {
  const card = item.card;
  const art = card?.imageUrl ?? card?.imageUrlSmall;
  const isSpellTrap = card?.type === "Spell Card" || card?.type === "Trap Card";

  const rows: [string, string][] = card
    ? [
        [t("Type"), translateType(card.type)],
        [isSpellTrap ? t("Propriété") : t("Type monstre"), translateRace(card.race, card.type) || "—"],
        [t("Attribut"), translateAttribute(card.attribute) || "—"],
        card.linkValue !== null
          ? [t("Lien"), String(card.linkValue)]
          : [t("Niveau"), card.level === null ? "—" : String(card.level)],
        [
          card.linkValue !== null ? t("ATK") : t("ATK / DEF"),
          card.linkValue !== null
            ? String(card.atk ?? "—")
            : `${card.atk ?? "—"} / ${card.def ?? "—"}`,
        ],
        [t("Archétype"), card.archetype ?? "—"],
        [t("Passcode"), `#${card.passcode}`],
      ]
    : [];

  const owned: [string, string][] = [
    [t("Set code"), item.setCode],
    [t("Édition"), item.print.setName ?? "—"],
    [t("Rareté"), item.print.rarity || "—"],
    [t("Langue"), item.print.language.toUpperCase()],
    [t("Exemplaires"), String(item.quantity)],
  ];

  const grid = (entries: [string, string][]): SafeHtml =>
    html`<dl class="detail-grid">
      ${entries.map(([term, value]) => html`<div><dt>${term}</dt><dd>${value}</dd></div>`)}
    </dl>`;

  return html`<div class="inspect-backdrop" id="inspect-backdrop"></div>
  <div class="inspect-panel" id="inspect-panel" role="dialog" aria-modal="true">
    <button type="button" class="inspect-close icon-btn" id="inspect-close" aria-label="${t("Fermer")}">✕</button>
    <div class="inspect-layout">
      <div class="inspect-art-col">
        ${art
          ? html`<img class="inspect-art" src="${art}" alt="" />`
          : raw(`<div class="inspect-art inspect-art-empty">?</div>`)}
      </div>
      <div class="inspect-info-col">
        <header class="inspect-info-head">
          <h2>${card?.name ?? "Carte non identifiée"}</h2>
          <p class="inspect-sub muted">${item.setCode} · ×${item.quantity}</p>
          <div class="inspect-actions">
            <button type="button" class="btn btn-danger btn-sm js-delta"
                    data-id="${item.id}" data-d="-1">−1</button>
          </div>
        </header>
        <div class="inspect-info-body">
          ${when(
            !card,
            raw(
              `<p class="muted">Cette édition n'a pas encore été identifiée. Elle est comptée dans votre collection ; l'identification se fera automatiquement.</p>`,
            ),
          )}
          ${when(Boolean(card), grid(rows))}
          ${when(
            /**
             * Le retard de traduction se dit, et il se dit une fois — près du
             * nom, qui est ce qu'on lit en premier.
             *
             * Le message ne peut pas être « cette carte n'a pas de nom
             * français » : c'est faux, « Aspischool » s'appelle « Banc d'aspis ».
             * C'est le catalogue qui ne l'a pas encore. Mesuré par extension :
             * les anciennes sont traduites à 100 %, les récentes à 0-60 %.
             */
            item.print.language === "fr" && card?.frenchPending,
            // « Pas encore » porte tout le sens : la carte a un nom français,
            // c'est le catalogue qui ne l'a pas. Le reste tenait de
            // l'explication de texte.
            html`<p class="muted field-note">${t("Traduction pas encore disponible — nom et texte en anglais.")}</p>`,
          )}
          ${when(
            Boolean(card?.desc),
            html`<div class="effect"><h3>${t("Effet")}</h3><p>${card?.desc}</p></div>`,
          )}
          ${linkCompassHtml(card?.linkMarkers ?? null, card?.linkValue ?? null)}
          <h3>${t("Votre exemplaire")}</h3>
          ${grid(owned)}
          <div class="inspect-notes">
            <label for="notes-input" class="muted">${t("Note")}</label>
            <input type="text" id="notes-input" value="${item.notes ?? ""}"
                   maxlength="2000" placeholder="${t("État, provenance, prix payé…")}" />
            <button type="button" class="btn btn-primary btn-sm" id="btn-save-notes">
              ${t("Enregistrer")}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

export function shellHtml(state: ViewState, facets: Facets): SafeHtml {
  return html`<main class="collection-page">
    <h1 class="page-heading">${t("Ma collection")}</h1>
    <div class="pin-rail" id="pin-rail" data-pinned="${String(state.pinned)}">
      <div class="tools-bar">
        <label class="search">
          <span class="search-icon" aria-hidden="true">⌕</span>
          <input type="search" id="filter" placeholder="${t("Rechercher une carte…")}"
                 aria-label="${t("Rechercher dans la collection")}" value="${state.query}" />
        </label>
        <div class="view-toggle" role="group" aria-label="${t("Mode d'affichage")}">
          <button type="button" class="icon-btn${state.view === "list" ? " is-active" : ""}"
                  data-view="list" title="${t("Liste")}" aria-label="${t("Vue liste")}"
                  aria-pressed="${String(state.view === "list")}"><span class="i-list" aria-hidden="true"></span></button>
          <button type="button" class="icon-btn${state.view === "gallery" ? " is-active" : ""}"
                  data-view="gallery" title="${t("Galerie")}" aria-label="${t("Vue galerie")}"
                  aria-pressed="${String(state.view === "gallery")}"><span class="i-grid" aria-hidden="true"></span></button>
        </div>
        <button type="button" class="icon-btn${state.pinned ? " is-active" : ""}" id="btn-pin"
                data-pin title="${t("Épingler la barre")}" aria-label="${t("Épingler la barre")}"
                aria-pressed="${String(state.pinned)}"><span class="i-pin" aria-hidden="true"></span></button>
        <button type="button" class="icon-btn" id="btn-more" title="${t("Trier et filtrer")}"
                aria-label="${t("Trier et filtrer")}" aria-haspopup="dialog"><span class="i-more" aria-hidden="true"></span></button>
        <!--
          Les scanlistes se rejoignent d'ici, et non par un onglet de la barre
          du bas — c'est la place qu'elles avaient dans ATEM-old, et elle dit
          juste : on répertorie un lot **avant** de décider s'il entre en
          collection. Un onglet de même rang que « Collection » laissait croire
          à deux inventaires côte à côte.
        -->
        <a class="btn scanlist-link" href="/scanlistes"
           title="${t("Répertorier un lot sans l'ajouter à la collection")}">
          <span aria-hidden="true">🗂️</span>
          <span class="scanlist-link-label">${t("Scanlistes")}</span>
        </a>
      </div>

      <div class="add-bar">
        <div class="add-field">
          <input type="text" id="set-code" class="add-input" autocomplete="off"
                 autocapitalize="characters" spellcheck="false"
                 aria-label="${t("Ajouter par set code")}"
                 placeholder="${t("Code carte (ex. LTGY-FR008)")}" />
          <button type="button" class="add-chevron" id="btn-chevron" aria-expanded="false"
                  aria-label="${t("Options (langue, rareté…)")}" title="${t("Options (langue, rareté…)")}">
            <span class="chevron" aria-hidden="true"></span>
          </button>
        </div>
        <button type="button" class="btn-add" id="btn-plus" title="${t("Ajouter")}"
                aria-label="${t("Ajouter la carte")}"><span aria-hidden="true">+</span></button>
        <button type="button" class="btn-scan" id="btn-scan" title="${t("Scanner le set code")}"
                aria-label="${t("Scanner")}"><span class="i-scan" aria-hidden="true"></span></button>
      </div>

      <div id="advanced-fields" class="add-advanced" hidden>
        <label class="add-select-wrap">
          <span class="add-select-label">${t("Langue")}</span>
          <select id="opt-lang">
            <option value="">${t("auto")}</option>
            <option value="fr">${t("FR")}</option>
            <option value="en">${t("EN")}</option>
          </select>
        </label>
        <label class="add-select-wrap add-select-passcode">
          <span class="add-select-label">${t("Passcode")}</span>
          <input type="text" id="opt-passcode" inputmode="numeric" autocomplete="off"
                 placeholder="${t("optionnel")}" aria-label="${t("Passcode de la carte")}" />
        </label>
      </div>

      <p class="meta-line">
        <span>${t("{montrées}/{total} édition(s) · {ex} ex.", { montrées: state.items.length, total: state.total, ex: state.totalCopies })}</span>
<span class="warn">${state.pending > 0 ? t("{n} en attente d'identification", { n: state.pending }) : ""}</span>
      </p>
    </div>

    <section class="content">${contentHtml(state)}</section>
  </main>
  ${filterPanelHtml(state, facets)}`;
}

export type PrintRow = {
  id: number;
  setCode: string;
  setName: string | null;
  rarity: string;
  language: string;
};

/**
 * Les autres éditions de la même carte.
 *
 * Repris d'ATEM-old : la question « est-ce que je l'ai déjà, et dans quelle
 * édition ? » se pose devant chaque carte qu'on trie. Y répondre dans la fiche
 * évite d'aller chercher ailleurs.
 *
 * Le bloc n'apparaît qu'à partir de deux éditions : en dessous, il n'apprend
 * rien que la fiche ne dise déjà.
 */
export function editionsHtml(prints: PrintRow[], ownedSetCodes: Set<string>): SafeHtml {
  if (prints.length < 2) return raw("");
  const possedees = prints.filter((print) => ownedSetCodes.has(print.setCode)).length;

  return html`<div class="editions">
    <h3span class="muted">${prints.length}${possedees > 0 ? ` · ${possedees} possédée${possedees > 1 ? "s" : ""}` : ""}</span>
    </h3>
    <ul class="editions-list">
      ${prints.map((print) => {
        const owned = ownedSetCodes.has(print.setCode);
        return html`<li class="edition-row${owned ? " is-owned" : ""}">
          <span class="edition-code">${print.setCode}</span>
          <span class="edition-set muted">${print.setName ?? "—"}</span>
          <span class="edition-rarity muted">${print.rarity || "—"}</span>
          <span class="edition-lang muted">${print.language.toUpperCase()}</span>
          ${owned
            ? raw(`<span class="edition-owned" title="${t("Vous possédez cette édition")}">✓</span>`)
            : raw(`<span class="edition-missing muted" title="${t("Pas dans votre collection")}">—</span>`)}
        </li>`;
      })}
    </ul>
  </div>`;
}
