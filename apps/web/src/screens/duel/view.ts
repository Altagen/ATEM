/**
 * The duels markup.
 *
 * Nothing to transcribe here: ATEM-old had no duels and the design does not
 * draw them (`docs/ref-duels.md` says why this is the one decided feature). So
 * it is built from the pieces the rest of the application already uses — the
 * directory's rows, the deck screen's modal, the same buttons — rather than a
 * vocabulary of its own.
 */
import { t, locale } from "../../platform/i18n/index.js";
import { avatarLooks } from "../../platform/avatar.js";
import { html, raw, when, type SafeHtml } from "../../platform/ui.js";
import type { Duel, DuelDetail, DuelSide, DuelState, DuelTurn } from "./state.js";

const day = (iso: string): string =>
  new Date(iso).toLocaleDateString(locale(), { day: "2-digit", month: "long", year: "numeric" });

/** The status, said in words — the colour alone is not a signal everyone gets. */
function statusLabel(duel: Duel): string {
  if (duel.status === "recorded") return t("Recorded");
  if (duel.status === "open") return t("In progress");
  return duel.isHost ? t("Invitation sent") : t("Invitation received");
}

function side(one: DuelSide, isWinner: boolean): SafeHtml {
  const look = one.player ? avatarLooks()[one.player.avatar] : null;
  return html`<div class="duel-side${isWinner ? " is-winner" : ""}">
    ${look
      ? html`<span class="user-avatar-badge" role="img" aria-label="${look.label}">${look.icon}</span>`
      : raw("")}
    <div class="duel-side-text">
      <strong>${one.player?.displayName ?? t("A duellist")}</strong>
      <span class="legende">${one.deck.name ?? t("No deck named")}</span>
    </div>
    <span class="duel-score">${one.score === null ? "—" : String(one.score)}</span>
  </div>`;
}

function duelRow(duel: Duel): SafeHtml {
  return html`<a class="player-card-row-full duel-row" href="/duels?duel=${duel.id}">
    <div class="duel-row-line">
      <span class="duel-status is-${duel.status}">${statusLabel(duel)}</span>
      <span class="legende">${day(duel.playedOn)}</span>
    </div>
    <div class="duel-row-players">
      ${side(duel.host, duel.winnerId === duel.host.player?.id)}
      <span class="duel-versus" aria-hidden="true">⚔️</span>
      ${side(duel.guest, duel.winnerId === duel.guest.player?.id)}
    </div>
  </a>`;
}

export function listHtml(state: DuelState): SafeHtml {
  const duels = state.duels;
  return html`<main class="community-app-container">
    <div class="duel-head">
      <h1 class="page-title">⚔️ ${t("Duels")}</h1>
      <button type="button" class="btn-showcase-primary-full is-moyen is-auto" id="btn-invite">
        ${t("Invite a friend")}
      </button>
    </div>

    <div class="directory-unified-frame">
      <div class="directory-full-panel">
        ${state.failure
          ? html`<div class="empty-state"><p class="empty-title">${state.failure}</p></div>`
          : duels === null
            ? html`<div class="empty-state"><p class="empty-title">${t("Loading…")}</p></div>`
            : duels.length === 0
              ? html`<div class="empty-state">
                  <p class="empty-title">${t("No duel yet")}</p>
                  <p class="muted">${t("Invite a friend: ATEM keeps the record of a duel played in person.")}</p>
                </div>`
              : html`<div class="player-cards-list-full">${duels.map(duelRow)}</div>`}
      </div>
    </div>
  </main>
  ${inviteModal(state)}`;
}

function turnRow(duel: DuelDetail, turn: DuelTurn): SafeHtml {
  const who = turn.playerId === duel.host.player?.id ? duel.host.player : duel.guest.player;
  return html`<tr>
    <td data-col="${t("Turn")}">${String(turn.number)}</td>
    <td data-col="${t("Played by")}">${who?.displayName ?? t("A duellist")}</td>
    <td data-col="${t("Life points")}">${String(turn.hostLife)} — ${String(turn.guestLife)}</td>
    <td data-col="${t("Note")}">${turn.note ?? ""}</td>
  </tr>`;
}

export function detailHtml(state: DuelState): SafeHtml {
  const duel = state.open;
  if (!duel) return html`<main class="community-app-container">
    <div class="empty-state"><p class="empty-title">${state.failure ?? t("Loading…")}</p></div>
  </main>`;

  const mine = duel.isHost ? duel.host : duel.guest;
  const waiting = duel.status === "proposed";
  return html`<main class="community-app-container">
    <a class="settings-back-btn" href="/duels">${t("← Duels")}</a>

    <section class="profile-section-card">
      <div class="duel-row-line">
        <span class="duel-status is-${duel.status}">${statusLabel(duel)}</span>
        <span class="legende">${day(duel.playedOn)}</span>
      </div>
      <div class="duel-row-players">
        ${side(duel.host, duel.winnerId === duel.host.player?.id)}
        <span class="duel-versus" aria-hidden="true">⚔️</span>
        ${side(duel.guest, duel.winnerId === duel.guest.player?.id)}
      </div>
      ${when(duel.note !== null && duel.note !== "", html`<p class="showcase-bio">${duel.note}</p>`)}

      <div class="duel-actions">
        ${when(waiting && !duel.isHost, html`
          <button type="button" class="btn-showcase-primary-full is-moyen is-auto" id="btn-accept">${t("Accept the duel")}</button>
          <button type="button" class="btn" id="btn-drop">${t("Decline")}</button>`)}
        ${when(waiting && duel.isHost, html`
          <p class="legende">${t("Waiting for the other duellist to accept.")}</p>
          <button type="button" class="btn" id="btn-drop">${t("Cancel the invitation")}</button>`)}
        ${when(duel.status === "open", html`
          <button type="button" class="btn-showcase-primary-full is-moyen is-auto" id="btn-result">${t("Record the result")}</button>
          <button type="button" class="btn" id="btn-deck">${mine.deck.name ? t("Change my deck") : t("Name my deck")}</button>
          <button type="button" class="btn" id="btn-drop">${t("Call it off")}</button>`)}
      </div>
    </section>

    <section class="profile-section-card">
      <h2 class="profile-section-title"><span aria-hidden="true">📜</span><span>${t("Turn by turn")}</span></h2>
      ${duel.turns.length === 0
        ? html`<div class="empty-state is-encadre">
            <p class="empty-title">${t("No turn written")}</p>
            <p class="muted">${t("Both duellists write into the same history.")}</p>
          </div>`
        : html`<div class="admin-table-container">
            <table class="admin-table">
              <thead><tr>
                <th>${t("Turn")}</th><th>${t("Played by")}</th><th>${t("Life points")}</th><th>${t("Note")}</th>
              </tr></thead>
              <tbody>${duel.turns.map((turn) => turnRow(duel, turn))}</tbody>
            </table>
          </div>`}
      ${when(duel.status === "open", html`
        <button type="button" class="btn" id="btn-turn">${t("Write a turn")}</button>`)}
    </section>
  </main>
  ${resultModal(state)}
  ${turnModal(state)}
  ${deckModal(state)}`;
}

function inviteModal(state: DuelState): SafeHtml {
  const invite = state.invite;
  if (!invite) return html``;
  const friends = state.friends ?? [];
  return html`<div class="deck-modal-backdrop" id="duel-modal-backdrop"></div>
  <div class="deck-modal" role="dialog" aria-modal="true" aria-labelledby="invite-title">
    <div class="deck-modal-head"><h2 id="invite-title">⚔️ ${t("Invite a friend")}</h2></div>
    <form class="deck-modal-body" id="form-invite">
      ${friends.length === 0
        ? html`<p class="legende">${t("A duel is played with a friend — the Community screen is where you find them.")}</p>`
        : html`<div class="bloc-champ">
            <label class="champ-libelle" for="invite-guest">${t("Which friend?")}</label>
            <select id="invite-guest" class="search-input-gaming is-nue">
              ${friends.map((friend) => html`<option value="${friend.id}"${friend.id === invite.guestId ? raw(" selected") : raw("")}>
                ${friend.displayName} #${friend.tag}
              </option>`)}
            </select>
          </div>
          <div class="bloc-champ">
            <label class="champ-libelle" for="invite-date">${t("Played on")}</label>
            <input type="date" id="invite-date" class="search-input-gaming is-nue" value="${invite.playedOn}" />
          </div>
          ${deckField(state, invite.deckId, "invite-deck", t("My deck (optional)"))}`}
      <div class="deck-modal-foot">
        <button type="button" class="btn" id="duel-modal-cancel">${t("Cancel")}</button>
        ${when(friends.length > 0, html`<button type="submit" class="btn-showcase-primary-full is-moyen is-auto"
                ${state.busy ? raw("disabled") : raw("")}>${t("Send the invitation")}</button>`)}
      </div>
    </form>
  </div>`;
}

/** The deck picker, shared by the invitation, the result and “name my deck”. */
function deckField(state: DuelState, chosen: string, id: string, label: string): SafeHtml {
  const decks = state.decks ?? [];
  return html`<div class="bloc-champ">
    <label class="champ-libelle" for="${id}">${label}</label>
    <select id="${id}" class="search-input-gaming is-nue">
      <option value=""${chosen === "" ? raw(" selected") : raw("")}>${t("Not said")}</option>
      ${decks.map((deck) => html`<option value="${deck.id}"${deck.id === chosen ? raw(" selected") : raw("")}>
        ${deck.name}
      </option>`)}
    </select>
  </div>`;
}

function resultModal(state: DuelState): SafeHtml {
  const result = state.result;
  const duel = state.open;
  if (!result || !duel) return html``;
  return html`<div class="deck-modal-backdrop" id="duel-modal-backdrop"></div>
  <div class="deck-modal" role="dialog" aria-modal="true" aria-labelledby="result-title">
    <div class="deck-modal-head"><h2 id="result-title">🏁 ${t("Record the result")}</h2></div>
    <form class="deck-modal-body" id="form-result">
      <p class="legende">${t("Wins each. Equal scores are a draw.")}</p>
      <div class="duel-score-fields">
        <div class="bloc-champ">
          <label class="champ-libelle" for="result-host">${duel.host.player?.displayName ?? t("Host")}</label>
          <input type="number" id="result-host" class="search-input-gaming is-nue" min="0" max="99"
                 inputmode="numeric" value="${result.hostScore}" />
        </div>
        <div class="bloc-champ">
          <label class="champ-libelle" for="result-guest">${duel.guest.player?.displayName ?? t("Guest")}</label>
          <input type="number" id="result-guest" class="search-input-gaming is-nue" min="0" max="99"
                 inputmode="numeric" value="${result.guestScore}" />
        </div>
      </div>
      <div class="bloc-champ">
        <label class="champ-libelle" for="result-note">${t("A word about it (optional)")}</label>
        <input type="text" id="result-note" class="search-input-gaming is-nue" maxlength="2000" value="${result.note}" />
      </div>
      <div class="deck-modal-foot">
        <button type="button" class="btn" id="duel-modal-cancel">${t("Cancel")}</button>
        <button type="submit" class="btn-showcase-primary-full is-moyen is-auto"
                ${state.busy ? raw("disabled") : raw("")}>${t("Record")}</button>
      </div>
    </form>
  </div>`;
}

function turnModal(state: DuelState): SafeHtml {
  const turn = state.turn;
  const duel = state.open;
  if (!turn || !duel) return html``;
  const players = [duel.host.player, duel.guest.player].filter((one) => one !== null);
  return html`<div class="deck-modal-backdrop" id="duel-modal-backdrop"></div>
  <div class="deck-modal" role="dialog" aria-modal="true" aria-labelledby="turn-title">
    <div class="deck-modal-head"><h2 id="turn-title">📜 ${t("Turn {n}", { n: String(turn.number) })}</h2></div>
    <form class="deck-modal-body" id="form-turn">
      <div class="bloc-champ">
        <label class="champ-libelle" for="turn-player">${t("Played by")}</label>
        <select id="turn-player" class="search-input-gaming is-nue">
          ${players.map((one) => html`<option value="${one.id}"${one.id === turn.playerId ? raw(" selected") : raw("")}>
            ${one.displayName}
          </option>`)}
        </select>
      </div>
      <div class="duel-score-fields">
        <div class="bloc-champ">
          <label class="champ-libelle" for="turn-host">${duel.host.player?.displayName ?? t("Host")}</label>
          <input type="number" id="turn-host" class="search-input-gaming is-nue" min="0" max="99999"
                 inputmode="numeric" value="${turn.hostLife}" />
        </div>
        <div class="bloc-champ">
          <label class="champ-libelle" for="turn-guest">${duel.guest.player?.displayName ?? t("Guest")}</label>
          <input type="number" id="turn-guest" class="search-input-gaming is-nue" min="0" max="99999"
                 inputmode="numeric" value="${turn.guestLife}" />
        </div>
      </div>
      <div class="bloc-champ">
        <label class="champ-libelle" for="turn-note">${t("What happened (optional)")}</label>
        <input type="text" id="turn-note" class="search-input-gaming is-nue" maxlength="280" value="${turn.note}" />
      </div>
      <div class="deck-modal-foot">
        <button type="button" class="btn" id="duel-modal-cancel">${t("Cancel")}</button>
        <button type="submit" class="btn-showcase-primary-full is-moyen is-auto"
                ${state.busy ? raw("disabled") : raw("")}>${t("Write the turn")}</button>
      </div>
    </form>
  </div>`;
}

function deckModal(state: DuelState): SafeHtml {
  const pick = state.deckPick;
  if (!pick) return html``;
  return html`<div class="deck-modal-backdrop" id="duel-modal-backdrop"></div>
  <div class="deck-modal" role="dialog" aria-modal="true" aria-labelledby="duel-deck-title">
    <div class="deck-modal-head"><h2 id="duel-deck-title">🃏 ${t("My deck")}</h2></div>
    <form class="deck-modal-body" id="form-duel-deck">
      <p class="legende">${t("The name is kept with the duel, so its history still reads if the deck goes.")}</p>
      ${deckField(state, pick.deckId, "duel-deck", t("My deck"))}
      <div class="deck-modal-foot">
        <button type="button" class="btn" id="duel-modal-cancel">${t("Cancel")}</button>
        <button type="submit" class="btn-showcase-primary-full is-moyen is-auto"
                ${state.busy ? raw("disabled") : raw("")}>${t("Save")}</button>
      </div>
    </form>
  </div>`;
}
