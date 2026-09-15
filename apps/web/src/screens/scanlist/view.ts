/**
 * The scanlists' markup.
 *
 * Classes taken from ATEM-old's mock-up
 * (`design/styles/pages/scanlist.css`), whose stylesheet had been waiting in
 * `design/staged/pages/scanlist.css` since the start of the milestone.
 */
import { t } from "../../platform/i18n/index.js";
import { html, raw, when, type SafeHtml } from "../../platform/ui.js";
import type { ScanlistDetail, ScanlistLine, ScanlistSummary } from "@atem/shared";
import { draftCopies, type Draft, type ScanlistState } from "./state.js";

const shortDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });

/** A batch row: the name when we have it, the code otherwise. Never anything else. */
const rowLabel = (line: ScanlistLine): string => line.name ?? line.setCode;

function draftRow(line: ScanlistLine): SafeHtml {
  return html`<li class="scan-draft-li">
    <span>
      <strong>${rowLabel(line)}</strong>
      ${when(line.name, html`<span class="muted"> · ${line.setCode}</span>`)}
    </span>
    <button type="button" class="btn-qty btn-qty-danger js-draft" data-code="${line.setCode}" data-d="-1"
            aria-label="${t("Remove a copy of {name}", { name: rowLabel(line) })}">−</button>
    <span class="scan-line-qty">×${line.quantity}</span>
    <button type="button" class="btn-qty js-draft" data-code="${line.setCode}" data-d="1"
            aria-label="${t("Add a copy of {name}", { name: rowLabel(line) })}">+</button>
  </li>`;
}

function draftHtml(draft: Draft): SafeHtml {
  const references = draft.lines.length;
  const copies = draftCopies(draft);

  return html`
    <section class="scan-draft-panel">
      <h2 class="section-title">${t("Batch in progress")}</h2>
      <p class="scan-note muted">
        ${t("This batch never leaves this device and does not survive closing the tab. Save it to keep it.")}
      </p>

      <div class="scan-actions">
        <div class="add-field">
          <input type="text" id="draft-name" class="add-input" maxlength="60"
                 placeholder="${t("Batch name (e.g. Order of 3 March)")}"
                 aria-label="${t("Batch name")}" value="${draft.name}" />
        </div>
      </div>

      <div class="scan-actions">
        <div class="add-field">
          <input type="text" id="draft-code" class="add-input"
                 autocapitalize="characters" autocomplete="off" spellcheck="false"
                 placeholder="${t("LTGY-FR008")}" aria-label="${t("Add by set code")}" />
        </div>
        <button type="button" class="btn-add" id="draft-add" title="${t("Add")}"
                aria-label="${t("Add to batch")}"><span aria-hidden="true">+</span></button>
        <button type="button" class="btn-scan" id="draft-scan" title="${t("Scan a card")}"
                aria-label="${t("Scan")}"><span class="i-scan" aria-hidden="true"></span></button>
      </div>

      <p class="scan-count muted">${t("{ref} reference(s) · ×{copies}", { ref: references, copies: copies })}</p>

      ${draft.lines.length === 0
        ? raw(`<p class="scan-draft-empty muted">${t("Nothing yet. Scan a card, or type its code.")}</p>`)
        : html`<ul class="scan-draft">${draft.lines.map(draftRow)}</ul>`}

      <div class="scan-actions">
        <button type="button" class="btn btn-hero" id="draft-save">${t("Save the batch")}</button>
        <button type="button" class="btn scan-trash" id="draft-discard">${t("Discard")}</button>
      </div>
    </section>
  `;
}

function listRow(item: ScanlistSummary): SafeHtml {
  const poured = item.pouredAt !== null;
  return html`<li class="scan-li${poured ? " is-poured" : ""}">
    <a class="scan-row" href="/scanlists?batch=${item.id}">
      <span class="scan-row-ico" aria-hidden="true">🗂️</span>
      <span class="scan-row-text">
        <strong>${item.name}</strong>
        <span class="muted"> · ${t("{ref} ref. · ×{copies}", { ref: item.lineCount, copies: item.copyCount })}</span>
      </span>
      <span class="muted">${shortDate(item.createdAt)}</span>
      <span class="scan-state ${poured ? "is-poured" : "is-pending"}">
        ${poured ? t("Poured") : t("Pending")}
      </span>
    </a>
  </li>`;
}

function detailHtml(batch: ScanlistDetail, failures: ScanlistState["pourErrors"]): SafeHtml {
  const poured = batch.pouredAt !== null;
  return html`
    <div class="scan-head">
      <div>
        <h1 class="page-title">${batch.name}</h1>
        <p class="muted">
          ${t("{ref} reference(s) · ×{copies} · created on {date}", { ref: batch.lineCount, copies: batch.copyCount, date: shortDate(batch.createdAt) })}
        </p>
      </div>
      <a class="btn scan-new" href="/scanlists">${t("All batches")}</a>
    </div>

    <p class="scan-state scan-state-big ${poured ? "is-poured" : "is-pending"}">
      ${poured ? t("Poured on {date}", { date: shortDate(batch.pouredAt!) }) : t("Waiting to be poured")}
    </p>

    <div class="scan-actions">
      <button type="button" class="btn btn-hero" id="batch-pour" ${poured ? raw("disabled") : raw("")}>
        ${t("Pour into collection")}
      </button>
      <button type="button" class="btn" id="batch-export">${t("Export as JSON")}</button>
      <button type="button" class="btn scan-trash" id="batch-delete">${t("Discard this batch")}</button>
    </div>

    ${when(
      failures.length > 0,
      html`<div class="scan-errors">
        <p class="scan-note warn">
          ${t("{n} line(s) could not be poured. The rest went in.", { n: failures.length })}
        </p>
        <ul class="scan-draft">
          ${failures.map(
            (failure) => html`<li class="scan-draft-li">
              <span><strong>${failure.setCode}</strong></span>
              <span class="muted">${failure.error}</span>
              <span></span>
              <span></span>
            </li>`,
          )}
        </ul>
      </div>`,
    )}

    <ul class="scan-draft">
      ${batch.lines.map(
        (line) => html`<li class="scan-draft-li">
          <span>
            <strong>${rowLabel(line)}</strong>
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
          <h1 class="page-title">${t("Scanlists")}</h1>
          <p class="muted">
            ${t("Inventory a batch without pouring it into your collection — a delivery, a trade, a box to sort. You decide afterwards.")}
          </p>
        </div>
        ${when(
          !state.draft,
          html`<button type="button" class="btn btn-hero scan-new" id="draft-start">
            ${t("New batch")}
          </button>`,
        )}
      </div>

      ${when(state.error, html`<p class="scan-note warn">${state.error}</p>`)}
      ${state.draft ? draftHtml(state.draft) : raw("")}

      <p class="scan-count muted">${t("{n} saved batch(es)", { n: state.items.length })}</p>
      ${state.loading
        ? raw(`<p class="web-loading muted">${t("Loading…")}</p>`)
        : state.items.length === 0
          ? raw(`<p class="scan-draft-empty muted">${t("No saved batches yet.")}</p>`)
          : html`<ul class="scan-list">${state.items.map(listRow)}</ul>`}
    </div>
  `;
}
