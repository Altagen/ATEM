/**
 * The console's markup.
 *
 * The earlier prototype's console, reduced with Ange on 2026-09-21 to what a host needs —
 * the count, who may sign up, the accounts, and what the administrator did —
 * and drawn with the application's own pieces rather than its 800 lines of
 * admin styles: the directory's rows, the profile card's figures, the
 * settings' choice cards, the decks' confirmation window.
 */
import { locale, t } from "../../platform/i18n/index.js";
import { html, raw, when, type SafeHtml } from "../../platform/ui.js";
import type { AdminAccount, AdminLogEntry, AdminState, AdminTab } from "./state.js";

const dateOf = (iso: string): string =>
  new Date(iso).toLocaleDateString(locale(), { day: "2-digit", month: "short", year: "numeric" });

const momentOf = (iso: string): string =>
  new Date(iso).toLocaleString(locale(), { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

function tab(state: AdminState, which: AdminTab, label: string): SafeHtml {
  return html`<button type="button" class="chip-btn${state.tab === which ? " is-active" : ""}"
          data-tab="${which}" aria-pressed="${String(state.tab === which)}">${label}</button>`;
}

const figure = (value: number | undefined, label: string): SafeHtml => html`<div class="showcase-stat">
  <span class="showcase-stat-value">${value === undefined ? "—" : String(value)}</span>
  <span class="muted">${label}</span>
</div>`;

function overviewHtml(state: AdminState): SafeHtml {
  const o = state.overview;
  const open = o?.registrationOpen;
  const choice = (value: boolean, label: string, hint: string) => html`<label
      class="radio-card${open === value ? " is-selected" : ""}">
    <input type="radio" name="registration" value="${value ? "open" : "closed"}"
           ${open === value ? raw("checked") : raw("")} />
    <span>
      <span class="radio-card-label">${label}</span>
      <span class="radio-card-hint">${hint}</span>
    </span>
  </label>`;
  return html`<div class="showcase-stats admin-figures">
      ${figure(o?.players, t("Players"))}
      ${figure(o?.online, t("Online now"))}
      ${figure(o?.suspended, t("Suspended"))}
    </div>
    <div class="settings-card-frame">
      <h2 class="titre-section">🔐 ${t("Registration")}</h2>
      <div class="radio-cards">
        ${choice(true, t("Open"), t("Anyone may create an account."))}
        ${choice(false, t("Closed"), t("Only the administrator creates accounts."))}
      </div>
    </div>`;
}

/** Where an account stands, in the words the row shows under its name. */
function standing(account: AdminAccount): SafeHtml {
  if (account.suspendedAt) {
    return html`<span class="admin-state is-suspended">⛔ ${t("Suspended on {date}", { date: dateOf(account.suspendedAt) })}</span>`;
  }
  if (account.mustChangePassword) {
    return html`<span class="admin-state">🔑 ${t("Has not signed in yet")}</span>`;
  }
  return html`<span>${account.lastSeenAt
    ? t("Last seen {date}", { date: dateOf(account.lastSeenAt) })
    : t("Never seen")}</span>`;
}

function accountRow(state: AdminState, account: AdminAccount): SafeHtml {
  const inert = state.busy.has(account.id) ? raw(" disabled") : raw("");
  return html`<div class="player-card-row-full" data-account="${account.id}">
    <div class="player-row-main-info">
      <div class="player-row-meta">
        <div class="player-row-title-line">
          <span class="player-row-name">${account.displayName}</span>
          <span class="player-row-tag">#${account.tag}</span>
        </div>
        <div class="player-row-subtitle">
          <span>${account.email}</span>
          <span class="player-row-sep" aria-hidden="true">•</span>
          <span>${t("Since {date}", { date: dateOf(account.createdAt) })}</span>
          <span class="player-row-sep" aria-hidden="true">•</span>
          ${standing(account)}
        </div>
      </div>
    </div>
    <div class="player-row-actions">
      ${account.suspendedAt
        ? html`<button type="button" class="btn-showcase-secondary is-petit is-auto"
                  data-restore="${account.id}"${inert}>${t("Restore")}</button>`
        : html`<button type="button" class="btn-showcase-secondary is-petit is-auto"
                  data-suspend="${account.id}"${inert}>${t("Suspend")}</button>`}
      <button type="button" class="btn-action-danger-red is-petit is-auto"
              data-delete="${account.id}"${inert}>${t("Delete")}</button>
    </div>
  </div>`;
}

function createForm(state: AdminState): SafeHtml {
  const draft = state.draft;
  if (!draft) return html``;
  return html`<form class="settings-card-frame" id="form-create-account">
    <h2 class="titre-section">➕ ${t("Create an account")}</h2>
    <p class="legende">${t("The player chooses their own password at their first sign-in.")}</p>
    <div class="bloc-champ">
      <label class="champ-libelle" for="create-email">${t("Email address")}</label>
      <input type="email" id="create-email" class="search-input-gaming is-nue" autocomplete="off"
             value="${draft.email}" required />
    </div>
    <div class="bloc-champ">
      <label class="champ-libelle" for="create-name">${t("Display name")}</label>
      <input type="text" id="create-name" class="search-input-gaming is-nue" autocomplete="off"
             minlength="2" maxlength="32" value="${draft.displayName}" required />
    </div>
    <div class="bloc-champ">
      <label class="champ-libelle" for="create-password">${t("Temporary password")}</label>
      <input type="password" id="create-password" class="search-input-gaming is-nue" autocomplete="new-password"
             value="${draft.password}" required />
      <div id="create-password-meter"></div>
      <p class="legende">${t("Give it to the player yourself: they replace it at their first sign-in.")}</p>
    </div>
    <div class="admin-form-actions">
      <button type="button" class="btn" id="btn-create-cancel">${t("Cancel")}</button>
      <button type="submit" class="btn-showcase-primary-full is-moyen is-auto">${t("Create the account")}</button>
    </div>
  </form>`;
}

function accountsHtml(state: AdminState): SafeHtml {
  const list = state.accounts;
  return html`<div class="admin-toolbar">
      <div class="search-box-wrap">
        <span class="search-icon-inside" aria-hidden="true">🔍</span>
        <label class="u-visually-hidden" for="account-search">${t("Search for an account")}</label>
        <input type="search" id="account-search" class="search-input-gaming" autocomplete="off"
               placeholder="${t("Name, number or address…")}" value="${state.search}" />
      </div>
      ${when(state.draft === null, html`<button type="button" class="btn-showcase-primary-full is-moyen is-auto"
              id="btn-create-open">➕ ${t("Create an account")}</button>`)}
    </div>
    ${createForm(state)}
    <div class="player-cards-list-full">
      ${list === null
        ? html`<div class="empty-state"><p class="empty-title">${t("Loading…")}</p></div>`
        : list.length === 0
          ? html`<div class="empty-state"><p class="empty-title">${t("No account")}</p></div>`
          : list.map((account) => accountRow(state, account))}
    </div>
    ${when(state.accountsCursor !== null, html`<div class="admin-more">
      <button type="button" class="btn" id="btn-more-accounts">${t("Show more")}</button>
    </div>`)}`;
}

const ACTION_SENTENCES: Record<AdminLogEntry["action"], () => string> = {
  account_created: () => t("Account created"),
  account_suspended: () => t("Account suspended"),
  account_restored: () => t("Account restored"),
  account_deleted: () => t("Account deleted"),
  registration_opened: () => t("Registration opened"),
  registration_closed: () => t("Registration closed"),
};

function logHtml(state: AdminState): SafeHtml {
  const log = state.log;
  if (log === null) return html`<div class="empty-state"><p class="empty-title">${t("Loading…")}</p></div>`;
  if (log.length === 0) {
    return html`<div class="empty-state"><p class="empty-title">${t("Nothing done yet")}</p></div>`;
  }
  return html`<ul class="admin-log">
      ${log.map((entry) => html`<li class="admin-log-line">
        <time class="muted" datetime="${entry.createdAt}">${momentOf(entry.createdAt)}</time>
        <strong>${ACTION_SENTENCES[entry.action]()}</strong>
        ${when(entry.targetLabel !== null, html`<span>${entry.targetLabel ?? ""}</span>`)}
      </li>`)}
    </ul>
    ${when(state.logCursor !== null, html`<div class="admin-more">
      <button type="button" class="btn" id="btn-more-log">${t("Show more")}</button>
    </div>`)}`;
}

function deleteModal(state: AdminState): SafeHtml {
  const account = state.deleting;
  if (!account) return html``;
  return html`<div class="deck-modal-backdrop" id="admin-modal-backdrop"></div>
  <div class="deck-modal" role="dialog" aria-modal="true" aria-labelledby="delete-title">
    <div class="deck-modal-head"><h2 id="delete-title">🗑 ${t("Delete this account?")}</h2></div>
    <div class="deck-modal-body">
      <p class="legende">${t("{name} and everything it holds — collection, decks, duels, friends — are erased. It cannot be undone.", { name: `${account.displayName}#${account.tag}` })}</p>
      <div class="deck-modal-foot">
        <button type="button" class="btn" id="btn-delete-cancel">${t("Cancel")}</button>
        <button type="button" class="btn-action-danger-red is-moyen is-auto" id="btn-delete-confirm">
          ${t("Delete for good")}
        </button>
      </div>
    </div>
  </div>`;
}

export function adminHtml(state: AdminState): SafeHtml {
  return html`<main class="community-app-container">
    <h1 class="page-title">🛡️ ${t("Administration")}</h1>
    <div class="filter-chips-row admin-tabs" role="group" aria-label="${t("Administration")}">
      ${tab(state, "overview", t("📊 Overview"))}
      ${tab(state, "accounts", t("👥 Accounts"))}
      ${tab(state, "log", t("📜 Log"))}
    </div>
    ${when(state.failure !== null, html`<p class="banner banner-err">${state.failure ?? ""}</p>`)}
    <div class="directory-unified-frame">
      <div class="directory-full-panel">
        ${state.tab === "overview" ? overviewHtml(state) : state.tab === "accounts" ? accountsHtml(state) : logHtml(state)}
      </div>
    </div>
    ${deleteModal(state)}
  </main>`;
}
