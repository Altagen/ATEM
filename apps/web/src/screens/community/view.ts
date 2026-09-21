/**
 * The community markup — ATEM-old's duellist directory.
 *
 * Transcribed from its `community/vue.ts` and the design's `community.js`, with
 * their classes. Left out, because the data behind them does not exist: the rank
 * badge, the derived “title”, and the guild badge on each row — guilds have no
 * module yet. The guild tab of the original screen goes with them, and with it
 * the tab bar: one tab is not a choice.
 */
import { locale, t } from "../../platform/i18n/index.js";
import { avatarLooks } from "../../platform/avatar.js";
import { html, raw, when, type SafeHtml } from "../../platform/ui.js";
import type { CommunityFilter, CommunityState, Duellist } from "./state.js";

/** The list the chips and the rows read, already filtered and searched. */
export function visible(state: CommunityState): Duellist[] {
  if (state.filter === "blocked") return state.blocked ?? [];
  const all = state.duellists ?? [];
  if (state.filter === "friends") return all.filter((one) => one.friendStatus === "friends");
  if (state.filter === "online") return all.filter((one) => one.isOnline);
  return all;
}

function chip(state: CommunityState, filter: CommunityFilter, label: string, count: number | null): SafeHtml {
  return html`<button type="button" class="chip-btn${state.filter === filter ? " is-active" : ""}"
          data-filter="${filter}" aria-pressed="${String(state.filter === filter)}">
    ${count === null ? label : `${label} (${count})`}
  </button>`;
}

/**
 * What one can do about a relation, in the state it is in.
 *
 * Four states, four different gestures: ATEM-old shipped a single “Add” that
 * said nothing about a request already sent.
 */
function actions(one: Duellist, busy: boolean): SafeHtml {
  const inert = busy ? raw(" disabled") : raw("");
  if (one.friendStatus === "friends") {
    return html`<button type="button" class="btn-showcase-secondary is-petit is-auto"
            data-remove="${one.id}"${inert}>${t("Remove friend")}</button>`;
  }
  if (one.friendStatus === "pending_sent") {
    return html`<button type="button" class="btn-showcase-secondary is-petit is-auto"
            data-remove="${one.id}"${inert}>⌛ ${t("Cancel request")}</button>`;
  }
  if (one.friendStatus === "pending_received") {
    return html`<button type="button" class="btn-showcase-primary-full is-petit is-auto"
            data-accept="${one.id}"${inert}>${t("Accept")}</button>
      <button type="button" class="btn-showcase-secondary is-petit is-auto"
              data-remove="${one.id}"${inert}>${t("Decline")}</button>`;
  }
  return html`<button type="button" class="btn-showcase-primary-full is-petit is-auto"
          data-add="${one.id}"${inert}>${t("➕ Add friend")}</button>`;
}

function row(state: CommunityState, one: Duellist): SafeHtml {
  const look = avatarLooks()[one.avatar];
  const busy = state.busy.has(one.id);
  const blocked = state.filter === "blocked";
  return html`<div class="player-card-row-full" data-player-id="${one.id}">
    <div class="player-row-main-info">
      <span class="user-avatar-badge" role="img" aria-label="${look.label}">${look.icon}</span>
      <div class="player-row-meta">
        <div class="player-row-title-line">
          ${blocked
            ? html`<span class="player-row-name">${one.displayName}</span>`
            : html`<button type="button" class="player-row-name" data-preview="${one.id}">${one.displayName}</button>`}
          <span class="player-row-tag">#${one.tag}</span>
          ${when(one.role === "admin", html`<span class="settings-role-badge admin">${t("Instance administrator")}</span>`)}
          ${when(one.friendStatus === "friends", html`<span class="friend-star-fixed" aria-hidden="true">⭐</span>`)}
        </div>
        <div class="player-row-subtitle">
          <span class="status-dot ${one.isOnline ? "online" : "offline"}" aria-hidden="true"></span>
          <span>${one.isOnline ? t("Online") : t("Offline")}</span>
          ${when(one.bio !== "", html`<span class="player-row-sep" aria-hidden="true">•</span>
            <span class="player-row-bio">${one.bio}</span>`)}
        </div>
      </div>
    </div>
    <div class="player-row-actions">
      ${blocked
        ? html`<button type="button" class="btn-showcase-secondary is-petit is-auto"
                  data-unblock="${one.id}"${busy ? raw(" disabled") : raw("")}>${t("Unblock")}</button>`
        : actions(one, busy)}
    </div>
  </div>`;
}

/**
 * The duellist's card, opened from a row — ATEM-old's `PlayerPreview`.
 *
 * What it shows is what the row already holds: the card is a closer look, not
 * a second request. The profile is one link further.
 */
function previewHtml(state: CommunityState, one: Duellist): SafeHtml {
  const look = avatarLooks()[one.avatar];
  const busy = state.busy.has(one.id);
  const since = new Date(one.createdAt).toLocaleDateString(locale(), { month: "long", year: "numeric" });
  return html`<div class="modal-backdrop" id="preview-backdrop">
    <div class="modal modal-showcase" role="dialog" aria-modal="true" aria-labelledby="preview-name">
      <button type="button" class="modal-close" id="preview-close" aria-label="${t("Close")}">✕</button>
      <div class="modal-body">
        <div class="showcase-banner-bg"><div class="showcase-banner-pattern"></div></div>
        <div class="showcase-body">
          <div class="showcase-identity-row">
            <div class="showcase-avatar-col">
              <span class="user-avatar-badge showcase-avatar" role="img" aria-label="${look.label}">${look.icon}</span>
              <span class="showcase-status">
                <span class="status-dot ${one.isOnline ? "online" : "offline"}" aria-hidden="true"></span>
                ${one.isOnline ? t("Online") : t("Offline")}
              </span>
            </div>
            <h2 class="showcase-name" id="preview-name">${one.displayName} <span class="muted">#${one.tag}</span></h2>
          </div>
          <div class="showcase-grid">
            ${one.role === "admin"
              ? html`<span class="showcase-title-tag">${t("Instance administrator")}</span>`
              : html`<span></span>`}
            <div class="showcase-actions">
              ${actions(one, busy)}
              <a class="btn-showcase-secondary is-petit is-auto" href="/profile?user=${one.id}">${t("View profile")}</a>
            </div>
            <span></span>
            <div class="showcase-actions">
              <button type="button" class="btn-modal-block-toggle" data-block="${one.id}"${busy ? raw(" disabled") : raw("")}>
                ⛔ ${t("Block")}
              </button>
            </div>
          </div>
          ${when(one.bio !== "", html`<p class="showcase-bio">${one.bio}</p>`)}
          <div class="showcase-stats">
            <div class="showcase-stat">
              <span class="muted">${t("Member since")}</span>
              <span class="showcase-stat-value">${since}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

export function communityHtml(state: CommunityState): SafeHtml {
  const all = state.duellists;
  const rows = visible(state);
  const loading = state.filter === "blocked" ? state.blocked === null : all === null;
  const previewed = all?.find((one) => one.id === state.preview);

  return html`<main class="community-app-container">
    <h1 class="page-title">🌐 ${t("Community")}</h1>

    <div class="directory-unified-frame">
      <div class="directory-full-panel">
        <div class="search-box-wrap">
          <span class="search-icon-inside" aria-hidden="true">🔍</span>
          <label class="u-visually-hidden" for="duellist-search">${t("Search for a duellist")}</label>
          <input type="search" id="duellist-search" class="search-input-gaming" autocomplete="off"
                 placeholder="${t("Search by name or number…")}" value="${state.search}" />
        </div>

        <div class="filter-chips-row" role="group" aria-label="${t("Filter the duellists")}">
          ${chip(state, "all", t("🌐 All duellists"), all?.length ?? null)}
          ${chip(state, "friends", t("⭐ My friends"),
            all === null ? null : all.filter((one) => one.friendStatus === "friends").length)}
          ${chip(state, "online", t("🟢 Online"),
            all === null ? null : all.filter((one) => one.isOnline).length)}
          ${chip(state, "blocked", t("⛔ Blocked"), state.blocked?.length ?? null)}
        </div>

        <div class="player-cards-list-full">
          ${state.failure
            ? html`<div class="empty-state"><p class="empty-title">${state.failure}</p></div>`
            : loading
              ? html`<div class="empty-state"><p class="empty-title">${t("Loading…")}</p></div>`
              : rows.length === 0
                ? html`<div class="empty-state">
                    <p class="empty-title">${t("No duellist")}</p>
                    <p class="muted">${state.filter === "blocked"
                      ? t("You have blocked nobody.")
                      : t("Nobody matches this search.")}</p>
                  </div>`
                : rows.map((one) => row(state, one))}
          ${when(state.truncated && state.filter !== "blocked",
            html`<p class="muted player-row-more">${t("Only the first duellists are shown — search to narrow it down.")}</p>`)}
        </div>
      </div>
    </div>
    ${previewed ? previewHtml(state, previewed) : raw("")}
  </main>`;
}
