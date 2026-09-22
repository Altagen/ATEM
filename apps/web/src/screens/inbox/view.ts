/**
 * The inbox markup.
 *
 * The sentence is written **here**, from the kind of event and who caused it:
 * the row holds neither title nor message. The earlier prototype stored the sentence at the
 * moment it happened, so an inbox read in English still showed the French of
 * the day it arrived.
 *
 * The earlier prototype's inbox was a modal over the current screen, with category tabs and
 * an archive. It is a screen here — the phone reaches it like any other — and it
 * carries what is waiting, without the archive nobody asked for.
 */
import { t } from "../../platform/i18n/index.js";
import { avatarLooks } from "../../platform/avatar.js";
import { html, raw, when, type SafeHtml } from "../../platform/ui.js";
import type { InboxItem, InboxState } from "./state.js";

/**
 * The icon and the sentence each kind of event is read as.
 *
 * One sentence per kind, written here: the row holds the event, not its wording
 * (see the file's note). An unknown kind cannot happen — the server owns the
 * list — but it reads as the plainest sentence rather than as nothing.
 */
function sentence(item: InboxItem): { icon: string; text: string } {
  const name = item.actor?.displayName ?? t("A duellist");
  switch (item.kind) {
    case "friend_accepted":
      return { icon: "⭐", text: t("{name} accepted your friend request.", { name }) };
    case "duel_invite":
      return { icon: "⚔️", text: t("{name} invites you to a duel.", { name }) };
    case "duel_accepted":
      return { icon: "⚔️", text: t("{name} accepted your duel.", { name }) };
    case "duel_recorded":
      return { icon: "🏁", text: t("{name} recorded the result of your duel.", { name }) };
    default:
      return { icon: "🤝", text: t("{name} would like to be your friend.", { name }) };
  }
}

/** Is this line about a duel? Then the way through is that duel. */
const aboutDuel = (item: InboxItem): boolean => item.kind.startsWith("duel_");

/** “3 minutes ago”, at the coarseness that is actually useful. */
function when_(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return t("just now");
  if (minutes < 60) return t("{n} min ago", { n: String(minutes) });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t("{n} h ago", { n: String(hours) });
  return t("{n} d ago", { n: String(Math.round(hours / 24)) });
}

function line(state: InboxState, item: InboxItem): SafeHtml {
  const { icon, text } = sentence(item);
  const busy = state.busy.has(item.id);
  const inert = busy ? raw(" disabled") : raw("");
  const look = item.actor ? avatarLooks()[item.actor.avatar] : null;

  return html`<article class="player-card-row-full${item.isRead ? "" : " is-unread"}" data-item="${item.id}">
    <div class="player-row-main-info">
      ${look
        ? html`<span class="user-avatar-badge" role="img" aria-label="${look.label}">${look.icon}</span>`
        : html`<span class="inbox-item-ico" aria-hidden="true">${icon}</span>`}
      <div class="inbox-item-text">
        <strong>
          ${when(!item.isRead, html`<span class="inbox-unread-dot" aria-label="${t("Unread")}"></span>`)}
          ${icon} ${text}
        </strong>
        <span class="legende">${when_(item.createdAt)}</span>
        <div class="inbox-item-actions">
          ${when(item.kind === "friend_request" && item.actor !== null, html`
            <button type="button" class="btn-showcase-primary-full is-petit is-auto"
                    data-accept="${item.actor?.id ?? ""}" data-item-id="${item.id}"${inert}>${t("Accept")}</button>
            <button type="button" class="btn-showcase-secondary is-petit is-auto"
                    data-decline="${item.actor?.id ?? ""}" data-item-id="${item.id}"${inert}>${t("Decline")}</button>`)}
          ${when(aboutDuel(item) && item.subjectId !== null,
            html`<a class="btn-inbox-tool" href="/duels?duel=${item.subjectId ?? ""}">${t("See the duel")}</a>`)}
          ${when(aboutDuel(item) && item.subjectId === null,
            html`<a class="btn-inbox-tool" href="/duels">${t("See the duels")}</a>`)}
          ${when(item.actor !== null, html`<a class="btn-inbox-tool" href="/profile?user=${item.actor?.id ?? ""}">${t("See profile")}</a>`)}
          <button type="button" class="btn-inbox-delete" data-remove="${item.id}"
                  aria-label="${t("Remove this notification")}"${inert}>✕</button>
        </div>
      </div>
    </div>
  </article>`;
}

export function inboxHtml(state: InboxState): SafeHtml {
  const items = state.items;
  return html`<main class="community-app-container">
    <!--
      No “mark everything as read” button: opening the inbox is reading it, so
      the button would be an affordance for something already done. What is new
      keeps its mark for the visit, which is what one actually wants to see.
    -->
    <h1 class="page-title">📬 ${t("Inbox")}</h1>

    <div class="directory-unified-frame">
      <div class="directory-full-panel">
        ${state.failure
          ? html`<div class="empty-state"><p class="empty-title">${state.failure}</p></div>`
          : items === null
            ? html`<div class="empty-state"><p class="empty-title">${t("Loading…")}</p></div>`
            : items.length === 0
              ? html`<div class="empty-state">
                  <p class="empty-title">${t("Nothing is waiting")}</p>
                  <p class="muted">${t("Friend requests and what they become land here.")}</p>
                </div>`
              : html`<div class="player-cards-list-full">${items.map((item) => line(state, item))}</div>`}
      </div>
    </div>
  </main>`;
}
