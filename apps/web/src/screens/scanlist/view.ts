/**
 * Le balisage des scanlistes.
 *
 * Classes reprises de la maquette d'ATEM-old (`design/styles/pages/scanlist.css`),
 * dont la feuille attendait dans `design/staged/pages/scanlist.css` depuis le
 * début du jalon.
 */
import { t } from "../../platform/i18n/index.js";
import { html, raw, when, type SafeHtml } from "../../platform/ui.js";
import type { ScanlistDetail, ScanlistLine, ScanlistSummary } from "@atem/shared";
import { draftCopies, type Draft, type ScanlistState } from "./state.js";

const dateCourte = (iso: string): string =>
  new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });

/** Une ligne de lot : le nom si on l'a, le code sinon. Jamais rien d'autre. */
const nomLigne = (line: ScanlistLine): string => line.name ?? line.setCode;

function ligneBrouillon(line: ScanlistLine): SafeHtml {
  return html`<li class="scan-draft-li">
    <span>
      <strong>${nomLigne(line)}</strong>
      ${when(line.name, html`<span class="muted"> · ${line.setCode}</span>`)}
    </span>
    <button type="button" class="btn-qty btn-qty-danger js-draft" data-code="${line.setCode}" data-d="-1"
            aria-label="Retirer un exemplaire de ${nomLigne(line)}">−</button>
    <span class="scan-line-qty">×${line.quantity}</span>
    <button type="button" class="btn-qty js-draft" data-code="${line.setCode}" data-d="1"
            aria-label="Ajouter un exemplaire de ${nomLigne(line)}">+</button>
  </li>`;
}

function brouillonHtml(draft: Draft): SafeHtml {
  const références = draft.lines.length;
  const exemplaires = draftCopies(draft);

  return html`
    <section class="scan-draft-panel">
      <h2 class="titre-section">${t("Lot en cours")}</h2>
      <p class="scan-note muted"/p>

      <div class="scan-actions">
        <div class="add-field">
          <input type="text" id="draft-name" class="add-input" maxlength="60"
                 placeholder="${t("Nom du lot (ex. Commande du 3 mars)")}"
                 aria-label="${t("Nom du lot")}" value="${draft.name}" />
        </div>
      </div>

      <div class="scan-actions">
        <div class="add-field">
          <input type="text" id="draft-code" class="add-input"
                 autocapitalize="characters" autocomplete="off" spellcheck="false"
                 placeholder="${t("LTGY-FR008")}" aria-label="${t("Ajouter par set code")}" />
        </div>
        <button type="button" class="btn-add" id="draft-add" title="${t("Ajouter")}"
                aria-label="${t("Ajouter au lot")}"><span aria-hidden="true">+</span></button>
        <button type="button" class="btn-scan" id="draft-scan" title="${t("Scanner une carte")}"
                aria-label="${t("Scanner")}"><span class="i-scan" aria-hidden="true"></span></button>
      </div>

      <p class="scan-count muted">${t("{réf} référence(s) · {ex} ex.", { réf: références, ex: exemplaires })}</p>

      ${draft.lines.length === 0
        ? raw(`<p class="scan-draft-empty muted">${t("Rien encore. Scannez une carte, ou saisissez son code.")}</p>`)
        : html`<ul class="scan-draft">${draft.lines.map(ligneBrouillon)}</ul>`}

      <div class="scan-actions">
        <button type="button" class="btn btn-hero" id="draft-save">${t("Enregistrer le lot")}</button>
        <button type="button" class="btn scan-trash" id="draft-discard">${t("Abandonner")}</button>
      </div>
    </section>
  `;
}

function ligneListe(item: ScanlistSummary): SafeHtml {
  const versée = item.pouredAt !== null;
  return html`<li class="scan-li${versée ? " is-poured" : ""}">
    <a class="scan-row" href="/scanlistes?lot=${item.id}">
      <span class="scan-row-ico" aria-hidden="true">🗂️</span>
      <span class="scan-row-text">
        <strong>${item.name}</strong>
        <span class="muted"> · ${t("{réf} réf. · {ex} ex.", { réf: item.lineCount, ex: item.copyCount })}</span>
      </span>
      <span class="muted">${dateCourte(item.createdAt)}</span>
      <span class="scan-state ${versée ? "is-poured" : "is-pending"}">
        ${versée ? t("Versée") : t("En attente")}
      </span>
    </a>
  </li>`;
}

function detailHtml(lot: ScanlistDetail, échecs: ScanlistState["pourErrors"]): SafeHtml {
  const versée = lot.pouredAt !== null;
  return html`
    <div class="scan-head">
      <div>
        <h1 class="page-title">${lot.name}</h1>
        <p class="muted">
          ${t("{réf} référence(s) · {ex} ex. · créé le {date}", { réf: lot.lineCount, ex: lot.copyCount, date: dateCourte(lot.createdAt) })}
        </p>
      </div>
      <a class="btn scan-new" href="/scanlistes">${t("Tous les lots")}</a>
    </div>

    <p class="scan-state scan-state-big ${versée ? "is-poured" : "is-pending"}">
      ${versée ? t("Versée le {date}", { date: dateCourte(lot.pouredAt!) }) : t("En attente de versement")}
    </p>

    <div class="scan-actions">
      <button type="button" class="btn btn-hero" id="lot-pour" ${versée ? raw("disabled") : raw("")}>
        ${t("Verser dans la collection")}
      </button>
      <button type="button" class="btn" id="lot-export">${t("Exporter en JSON")}</button>
      <button type="button" class="btn scan-trash" id="lot-delete">${t("Jeter ce lot")}</button>
    </div>

    ${when(
      échecs.length > 0,
      html`<div class="scan-errors">
        <p class="scan-note warn">
          ${t("{n} ligne(s) n'ont pas pu être versées. Les autres sont entrées.", { n: échecs.length })}
        </p>
        <ul class="scan-draft">
          ${échecs.map(
            (échec) => html`<li class="scan-draft-li">
              <span><strong>${échec.setCode}</strong></span>
              <span class="muted">${échec.error}</span>
              <span></span>
              <span></span>
            </li>`,
          )}
        </ul>
      </div>`,
    )}

    <ul class="scan-draft">
      ${lot.lines.map(
        (line) => html`<li class="scan-draft-li">
          <span>
            <strong>${nomLigne(line)}</strong>
            ${when(line.name, html`<span class="muted"> · ${line.setCode}</span>`)}
          </span>
          <span></span>
          <span class="scan-line-qty">×${line.quantity}</span>
          <span></span>
        </li>`,
      )}
    </ul>
  `;
}

export function scanlistHtml(state: ScanlistState): SafeHtml {
  if (state.opened) {
    return html`<div class="scan-page">${detailHtml(state.opened, state.pourErrors)}</div>`;
  }

  return html`
    <div class="scan-page">
      <div class="scan-head">
        <div>
          <h1 class="page-title">${t("Scanlistes")}</h1>
          <p class="muted"/p>
        </div>
        ${when(
          !state.draft,
          html`<button type="button" class="btn btn-hero scan-new" id="draft-start">
            ${t("Nouveau lot")}
          </button>`,
        )}
      </div>

      ${when(state.error, html`<p class="scan-note warn">${state.error}</p>`)}
      ${state.draft ? brouillonHtml(state.draft) : raw("")}

      <p class="scan-count muted">${t("{n} lot(s) enregistré(s)", { n: state.items.length })}</p>
      ${state.loading
        ? raw(`<p class="web-loading muted">${t("Chargement…")}</p>`)
        : state.items.length === 0
          ? raw(`<p class="scan-draft-empty muted">${t("Aucun lot enregistré pour l'instant.")}</p>`)
          : html`<ul class="scan-list">${state.items.map(ligneListe)}</ul>`}
    </div>
  `;
}
