/**
 * Le balisage des scanlistes.
 *
 * Classes reprises de la maquette d'ATEM-old (`design/styles/pages/scanlist.css`),
 * dont la feuille attendait dans `design/staged/pages/scanlist.css` depuis le
 * début du jalon.
 */
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
      <h2 class="titre-section">Lot en cours</h2>
      <p class="scan-note muted">
        Ce lot ne quitte pas cet appareil et ne survit pas à la fermeture de
        l'onglet. Enregistrez-le pour le garder.
      </p>

      <div class="scan-actions">
        <div class="add-field">
          <input type="text" id="draft-name" class="add-input" maxlength="60"
                 placeholder="Nom du lot (ex. Commande du 3 mars)"
                 aria-label="Nom du lot" value="${draft.name}" />
        </div>
      </div>

      <div class="scan-actions">
        <div class="add-field">
          <input type="text" id="draft-code" class="add-input"
                 autocapitalize="characters" autocomplete="off" spellcheck="false"
                 placeholder="LTGY-FR008" aria-label="Ajouter par set code" />
        </div>
        <button type="button" class="btn-add" id="draft-add" title="Ajouter"
                aria-label="Ajouter au lot"><span aria-hidden="true">+</span></button>
        <button type="button" class="btn-scan" id="draft-scan" title="Scanner une carte"
                aria-label="Scanner"><span class="i-scan" aria-hidden="true"></span></button>
      </div>

      <p class="scan-count muted">${références} référence(s) · ${exemplaires} ex.</p>

      ${draft.lines.length === 0
        ? raw(`<p class="scan-draft-empty muted">Rien encore. Scannez une carte, ou saisissez son code.</p>`)
        : html`<ul class="scan-draft">${draft.lines.map(ligneBrouillon)}</ul>`}

      <div class="scan-actions">
        <button type="button" class="btn btn-hero" id="draft-save">Enregistrer le lot</button>
        <button type="button" class="btn scan-trash" id="draft-discard">Abandonner</button>
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
        <span class="muted"> · ${item.lineCount} réf. · ${item.copyCount} ex.</span>
      </span>
      <span class="muted">${dateCourte(item.createdAt)}</span>
      <span class="scan-state ${versée ? "is-poured" : "is-pending"}">
        ${versée ? "Versée" : "En attente"}
      </span>
    </a>
  </li>`;
}

function detailHtml(lot: ScanlistDetail): SafeHtml {
  const versée = lot.pouredAt !== null;
  return html`
    <div class="scan-head">
      <div>
        <h1 class="page-title">${lot.name}</h1>
        <p class="muted">
          ${lot.lineCount} référence(s) · ${lot.copyCount} ex. · créé le ${dateCourte(lot.createdAt)}
        </p>
      </div>
      <a class="btn scan-new" href="/scanlistes">Tous les lots</a>
    </div>

    <p class="scan-state scan-state-big ${versée ? "is-poured" : "is-pending"}">
      ${versée ? `Versée le ${dateCourte(lot.pouredAt!)}` : "En attente de versement"}
    </p>

    <div class="scan-actions">
      <button type="button" class="btn btn-hero" id="lot-pour" ${versée ? raw("disabled") : raw("")}>
        Verser dans la collection
      </button>
      <button type="button" class="btn" id="lot-export">Exporter en JSON</button>
      <button type="button" class="btn scan-trash" id="lot-delete">Jeter ce lot</button>
    </div>

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
    return html`<div class="scan-page">${detailHtml(state.opened)}</div>`;
  }

  return html`
    <div class="scan-page">
      <div class="scan-head">
        <div>
          <h1 class="page-title">Scanlistes</h1>
          <p class="muted">
            Inventoriez un lot sans le verser à votre collection — un arrivage, un
            échange, une boîte à trier. Vous décidez ensuite.
          </p>
        </div>
        ${when(
          !state.draft,
          html`<button type="button" class="btn btn-hero scan-new" id="draft-start">
            Nouveau lot
          </button>`,
        )}
      </div>

      ${when(state.error, html`<p class="scan-note warn">${state.error}</p>`)}
      ${state.draft ? brouillonHtml(state.draft) : raw("")}

      <p class="scan-count muted">${state.items.length} lot(s) enregistré(s)</p>
      ${state.loading
        ? raw(`<p class="web-loading muted">Chargement…</p>`)
        : state.items.length === 0
          ? raw(`<p class="scan-draft-empty muted">Aucun lot enregistré pour l'instant.</p>`)
          : html`<ul class="scan-list">${state.items.map(ligneListe)}</ul>`}
    </div>
  `;
}
