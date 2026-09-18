/**
 * The profile markup.
 *
 * **Transcribed from ATEM-old** (`profile/vue.ts` and the design's
 * `pages/profile.js`), with its classes, so its stylesheet applies unchanged.
 *
 * What was deliberately not carried over, because it showed things that were not
 * true:
 * - **the trophies and the title** (“KaibaCorp Grand Prix Champion”, “Level 100
 *   honorary title”) — invented by the server from the role alone;
 * - **the presence** — this application has no live connection to measure it;
 * - **the tournament banner**, invented news;
 * - **the guild strip** — guilds have no module yet.
 *
 * The friend and block buttons are here, on someone else's profile: it is where
 * you are when you decide either.
 */
import { AVATARS, LIMITS, textLengthStatus, type TextLengthStatus } from "@atem/shared";
import { avatarLooks } from "../../platform/avatar.js";
import { t } from "../../platform/i18n/index.js";
import { html, raw, when, type SafeHtml } from "../../platform/ui.js";
import type { PlayerProfile, ProfileState } from "./state.js";

/** The sentence under a counted field — only when it overflows. */
export function overMessage(status: TextLengthStatus): string {
  return status.state === "over"
    ? t("{n} character(s) too many — remove some to save.", { n: String(-status.remaining) })
    : "";
}

/** Is the edit window's content something the server will accept? */
export function draftReady(state: ProfileState): boolean {
  if (!state.draft || state.saving) return false;
  const name = state.draft.displayName.trim().length;
  return name >= LIMITS.displayName.min && name <= LIMITS.displayName.max
    && textLengthStatus(state.draft.bio, LIMITS.bio.max).state !== "over";
}

export function profileHtml(state: ProfileState): SafeHtml {
  if (state.failure) {
    return html`<main class="profile-full-page-container">
      <div class="empty-state">
        <p class="empty-title">${t("Profile not found")}</p>
        <p class="muted">${state.failure}</p>
      </div>
    </main>`;
  }
  if (!state.player) {
    return html`<main class="profile-full-page-container">
      <div class="empty-state"><p class="empty-title">${t("Loading…")}</p></div>
    </main>`;
  }
  return html`<main class="profile-full-page-container">
    ${heroHtml(state.player)}
    ${decksHtml(state.player)}
  </main>
  ${editModalHtml(state)}`;
}

function heroHtml(player: PlayerProfile): SafeHtml {
  const { profile, isOwner } = player;
  const look = avatarLooks()[profile.avatar];
  return html`<div class="profile-hero-card">
    <div class="profile-banner-hero"><div class="profile-banner-pattern"></div></div>
    <div class="profile-hero-body">
      <div class="profile-hero-avatar-row">
        <div class="profile-hero-avatar">
          <span class="user-avatar-badge" role="img" aria-label="${look.label}">${look.icon}</span>
        </div>
      </div>
      <div class="profile-identity-row">
        <h1 class="profile-identity">
          <span>${profile.displayName}</span>
          <span class="muted">#${profile.tag}</span>
          ${when(profile.role === "admin", html`<span class="settings-role-badge admin">${t("Instance administrator")}</span>`)}
        </h1>
        <div class="profile-status-row">
          <div class="profile-actions">
            ${when(isOwner, html`<button type="button" class="btn-showcase-primary-full is-moyen is-auto" id="btn-edit-profile">
              <span aria-hidden="true">✏️</span><span>${t("Edit profile")}</span>
            </button>`)}
            ${when(!isOwner, friendButton(player.friendStatus))}
            <button type="button" class="btn" id="btn-share-profile">
              <span aria-hidden="true">🔗</span><span>${t("Share profile")}</span>
            </button>
            ${when(!isOwner, html`<button type="button" class="btn-action-danger-red is-moyen is-auto" id="btn-block">
              <span aria-hidden="true">⛔</span><span>${t("Block")}</span>
            </button>`)}
          </div>
        </div>
      </div>
      <p class="profile-tally">${tally(player.duels)}</p>
      ${profile.bio
        ? html`<p class="showcase-bio">${profile.bio}</p>`
        : when(isOwner, html`<p class="showcase-bio muted">${t("No bio yet — “Edit profile” lets you write one.")}</p>`)}
    </div>
  </div>`;
}

/**
 * The relation gesture, in the state the relation is in.
 *
 * The same four states as the directory's rows, and the same routes: a sent
 * request can be cancelled, a received one accepted or declined.
 */
function friendButton(status: PlayerProfile["friendStatus"]): SafeHtml {
  if (status === "friends") {
    return html`<button type="button" class="btn" id="btn-friend-remove">
      <span aria-hidden="true">⭐</span><span>${t("Remove friend")}</span>
    </button>`;
  }
  if (status === "pending_sent") {
    return html`<button type="button" class="btn" id="btn-friend-remove">
      <span aria-hidden="true">⌛</span><span>${t("⌛ Cancel request")}</span>
    </button>`;
  }
  if (status === "pending_received") {
    return html`<button type="button" class="btn-showcase-primary-full is-moyen is-auto" id="btn-friend-accept">
      <span aria-hidden="true">🤝</span><span>${t("Accept")}</span>
    </button>
    <button type="button" class="btn" id="btn-friend-remove">${t("Decline")}</button>`;
  }
  return html`<button type="button" class="btn-showcase-primary-full is-moyen is-auto" id="btn-friend-add">
    <span aria-hidden="true">➕</span><span>${t("Add friend")}</span>
  </button>`;
}

/**
 * What this duellist has played — counted, where ATEM-old showed trophies it
 * derived from the role. Nothing is said when nothing has been recorded.
 */
function tally(duels: PlayerProfile["duels"]): string {
  if (duels.played === 0) return t("No duel recorded yet");
  const played = duels.played === 1
    ? t("1 duel played")
    : t("{n} duels played", { n: String(duels.played) });
  const won = duels.won === 1 ? t("1 won") : t("{n} won", { n: String(duels.won) });
  return `${played}, ${won}`;
}

function decksHtml(player: PlayerProfile): SafeHtml {
  const empty = player.isOwner
    ? t("You have no deck yet.")
    : t("This duellist has no deck yet.");
  return html`<section class="profile-section-card">
    <h2 class="profile-section-title"><span aria-hidden="true">🃏</span><span>${t("Decks")}</span></h2>
    ${player.decks.length === 0
      ? html`<div class="empty-state is-encadre"><p class="empty-title">${empty}</p></div>`
      : player.decks.map((deck) => html`<div class="profile-deck-item">
          <div class="profile-deck-ico" aria-hidden="true">🃏</div>
          <strong>${deck.name}</strong>
          <div class="muted">${deck.main === 1
            ? t("1 card in the Main Deck")
            : t("{n} cards in the Main Deck", { n: String(deck.main) })}</div>
        </div>`)}
  </section>`;
}

function editModalHtml(state: ProfileState): SafeHtml {
  const draft = state.draft;
  if (!draft) return html``;
  const bio = textLengthStatus(draft.bio, LIMITS.bio.max);
  const looks = avatarLooks();
  return html`<div class="deck-modal-backdrop" id="profile-modal-backdrop"></div>
  <div class="deck-modal" role="dialog" aria-modal="true" aria-labelledby="profile-edit-title">
    <div class="deck-modal-head">
      <h2 id="profile-edit-title">✏️ ${t("Edit my public profile")}</h2>
    </div>
    <form class="profile-edit-form" id="form-profile-edit">
      <div class="deck-modal-body">
        <p class="legende">${t("Your display name, your bio and your avatar.")}</p>

        <div class="bloc-champ">
          <label class="champ-libelle" for="edit-display-name">${t("Display name")}</label>
          <input type="text" id="edit-display-name" class="search-input-gaming is-nue"
                 minlength="${String(LIMITS.displayName.min)}" maxlength="${String(LIMITS.displayName.max)}"
                 autocomplete="nickname" value="${draft.displayName}" required />
        </div>

        <!-- No maxlength: it would cut a paste short without a word. The whole text
             is accepted, the counter says what is too much, saving waits. -->
        <div class="bloc-champ counted-field is-${bio.state}" id="edit-bio-field">
          <label class="champ-libelle" for="edit-bio">${t("Bio")}
            <span class="counted-count">${String(bio.length)}/${String(bio.limit)}</span>
          </label>
          <textarea id="edit-bio" class="search-input-gaming is-nue" rows="4"
                    aria-invalid="${String(bio.state === "over")}">${draft.bio}</textarea>
          <p class="counted-over" role="alert">${overMessage(bio)}</p>
        </div>

        <div class="bloc-champ">
          <span class="champ-libelle" id="edit-avatar-label">${t("Duellist avatar")}</span>
          <div class="avatar-choice-grid" role="group" aria-labelledby="edit-avatar-label">
            ${AVATARS.map((avatar) => html`<button type="button"
                  class="avatar-choice${avatar === draft.avatar ? " is-selected" : ""}"
                  data-avatar="${avatar}" aria-pressed="${String(avatar === draft.avatar)}">
                <span class="avatar-choice-ico" aria-hidden="true">${looks[avatar].icon}</span>
                <span class="avatar-choice-label">${looks[avatar].label}</span>
              </button>`)}
          </div>
        </div>
      </div>

      <!-- Outside the scrolling body: the buttons stay in view however long the form. -->
      <div class="deck-modal-foot">
        <button type="button" class="btn" id="profile-modal-cancel">${t("Cancel")}</button>
        <button type="submit" class="btn-showcase-primary-full is-moyen is-auto" id="profile-modal-save" ${draftReady(state) ? raw("") : raw("disabled")}>
          ${t("Save changes")}
        </button>
      </div>
    </form>
  </div>`;
}
