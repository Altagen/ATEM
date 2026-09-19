/**
 * The duels markup.
 *
 * Nothing to transcribe here: ATEM-old had no duels and the design does not
 * draw them (`docs/ref-duels.md` says why this is the one decided feature). So
 * it is built from the pieces the rest of the application already uses — the
 * directory's rows, the deck screen's modal, the same buttons — rather than a
 * vocabulary of its own.
 */
import { DUEL_PHASES, type DuelPhase } from "@atem/shared";
import { locale, t } from "../../platform/i18n/index.js";
import { avatarLooks } from "../../platform/avatar.js";
import { html, raw, when, type SafeHtml } from "../../platform/ui.js";
import type { Duel, DuelDetail, DuelEvent, DuelSide, DuelState } from "./state.js";

const day = (iso: string): string =>
  new Date(iso).toLocaleDateString(locale(), { day: "2-digit", month: "long", year: "numeric" });

/** The status, said in words — colour alone is not a signal everyone receives. */
function statusLabel(duel: Duel): string {
  if (duel.status === "recorded") return t("Recorded");
  if (duel.status === "playing") return t("In progress");
  if (duel.status === "accepted") return t("Ready to start");
  return duel.isHost ? t("Invitation sent") : t("Invitation received");
}

/** The phases, named as the game names them. */
function phaseName(phase: DuelPhase): string {
  switch (phase) {
    case "draw": return t("Draw Phase");
    case "standby": return t("Standby Phase");
    case "main1": return t("Main Phase 1");
    case "battle": return t("Battle Phase");
    case "main2": return t("Main Phase 2");
    default: return t("End Phase");
  }
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

/**
 * The duels screen: **the duel now, or the ones before**.
 *
 * Ange, on 2026-09-19: one plays one duel at a time, so the screen shows that
 * one — and files the rest under “past duels”. Invitations are not listed here
 * at all: they wait in the inbox until they are answered, which is where one
 * goes to answer them.
 */
export function listHtml(state: DuelState): SafeHtml {
  const duels = state.duels;
  /**
   * The duel now: the one accepted or being played, or an invitation one has
   * sent. An invitation **received** is not a duel one is in — it waits in the
   * inbox until it is answered (Ange, 2026-09-19).
   */
  const current = duels?.find((duel) =>
    duel.status === "accepted" || duel.status === "playing" || (duel.status === "proposed" && duel.isHost),
  ) ?? null;
  const past = duels?.filter((duel) => duel.status === "recorded") ?? [];
  const showing = state.showPast ? past : current ? [current] : [];

  return html`<main class="community-app-container">
    <div class="duel-head">
      <h1 class="page-title">⚔️ ${t("Duels")}</h1>
      ${when(!state.showPast && current === null, html`<button type="button"
            class="btn-showcase-primary-full is-moyen is-auto" id="btn-invite">
          ${t("Invite a friend")}
        </button>`)}
    </div>

    <div class="filter-chips-row" role="group" aria-label="${t("Duels")}">
      <button type="button" class="chip-btn${state.showPast ? "" : " is-active"}"
              data-duels="current" aria-pressed="${String(!state.showPast)}">${t("⚔️ The duel now")}</button>
      <button type="button" class="chip-btn${state.showPast ? " is-active" : ""}"
              data-duels="past" aria-pressed="${String(state.showPast)}">
        ${t("📜 Past duels")}${past.length > 0 ? ` (${past.length})` : ""}
      </button>
    </div>

    <div class="directory-unified-frame">
      <div class="directory-full-panel">
        ${state.failure
          ? html`<div class="empty-state"><p class="empty-title">${state.failure}</p></div>`
          : duels === null
            ? html`<div class="empty-state"><p class="empty-title">${t("Loading…")}</p></div>`
            : showing.length === 0
              ? html`<div class="empty-state">
                  <p class="empty-title">${state.showPast ? t("No duel played yet") : t("No duel under way")}</p>
                  <p class="muted">${state.showPast
                    ? t("A duel appears here once its result is recorded.")
                    : t("Invite a friend: ATEM keeps the record of a duel played in person.")}</p>
                </div>`
              : html`<div class="player-cards-list-full">${showing.map(duelRow)}</div>`}
      </div>
    </div>
  </main>
  ${inviteModal(state)}`;
}

/** One line of the history, in the words a duel is read in. */
function eventLine(duel: DuelDetail, event: DuelEvent): SafeHtml {
  const about = event.playerId === duel.host.player?.id ? duel.host.player : duel.guest.player;
  const name = about?.displayName ?? t("A duellist");
  // A phase event says nothing here: the phase column beside it already does.
  const text = event.kind === "life"
    ? t("{name}: {delta} life points", { name, delta: String(event.delta ?? 0) })
    : event.kind === "turn"
      ? t("{name} begins turn {n}", { name, n: String(event.turnNumber) })
      : event.kind === "start"
        ? t("{name} won the coin flip and begins.", { name })
        : "";
  return html`<tr>
    <td data-col="${t("Turn")}">${String(event.turnNumber)}</td>
    <td data-col="${t("Phase")}">${phaseName(event.phase)}</td>
    <td data-col="${t("What happened")}">${text}${event.note ? ` — ${event.note}` : ""}</td>
    <td data-col="${t("Life points")}">${String(event.hostLife)} — ${String(event.guestLife)}</td>
  </tr>`;
}

/** The amounts a duel deals in, offered on one's own life card. */
const LIFE_STEPS = [-1000, -500, -100, 100, 500, 1000] as const;

/**
 * One life card. The duellist's own carries its buttons; the other's does not.
 *
 * Ange's rule, on 2026-09-19: the one who takes the damage declares it. So the
 * opposite card is a figure to read, never a counter to reach across and move.
 */
function lifeCard(one: DuelSide, options: { mine: boolean; playing: boolean; busy: boolean }): SafeHtml {
  // The other duellist's card carries no button and says nothing about it: an
  // absent button needs no caption.
  const look = one.player ? avatarLooks()[one.player.avatar] : null;
  return html`<div class="duel-life${options.mine ? " is-mine" : ""}${options.playing ? " is-playing" : ""}">
    <div class="duel-life-who">
      ${look ? html`<span class="user-avatar-badge" role="img" aria-label="${look.label}">${look.icon}</span>` : raw("")}
      <span class="duel-life-name">${one.player?.displayName ?? t("A duellist")}</span>
      ${when(options.playing, html`<span class="duel-life-turn">${t("Playing")}</span>`)}
    </div>
    <strong class="duel-life-value" aria-live="polite">${String(one.life)}</strong>
    ${when(options.mine, html`<div class="duel-life-steps">
      ${LIFE_STEPS.map((step) => html`<button type="button" class="chip duel-step" data-step="${String(step)}"
            ${options.busy ? raw("disabled") : raw("")}>${step > 0 ? `+${step}` : `−${Math.abs(step)}`}</button>`)}
      <button type="button" class="chip duel-step" data-halve
              ${options.busy ? raw("disabled") : raw("")}>${t("÷2")}</button>
      <button type="button" class="chip duel-step" id="btn-life-other"
              ${options.busy ? raw("disabled") : raw("")}>${t("Other…")}</button>
    </div>`)}
  </div>`;
}

/**
 * The board: where the duel is, and everything one does from it.
 *
 * Ange, on 2026-09-19: “le mieux serait que l'historique soit replié et que tout
 * se passe sur le panneau de contrôle” — the two players arrange the rest
 * between themselves, at the table.
 */
function boardHtml(duel: DuelDetail, state: DuelState): SafeHtml {
  const phase = duel.phase ?? "draw";
  const mineIsHost = duel.isHost;
  const mine = mineIsHost ? duel.host : duel.guest;
  const theirs = mineIsHost ? duel.guest : duel.host;
  const playing = duel.currentPlayerId === duel.host.player?.id ? duel.host.player : duel.guest.player;
  const myTurn = duel.currentPlayerId === mine.player?.id;

  return html`<section class="profile-section-card duel-board">
    <div class="duel-board-head">
      <strong class="duel-turn">${t("Turn {n}", { n: String(duel.turnNumber ?? 1) })}</strong>
      <span class="duel-now${myTurn ? " is-you" : ""}" aria-live="polite">
        ${myTurn ? t("Your turn") : t("{name} is playing", { name: playing?.displayName ?? t("A duellist") })}
      </span>
    </div>

    <!--
      The phases as a path, the one under way marked: a duel is followed by
      knowing where one is, not by reading a word.
    -->
    <ol class="duel-phases" aria-label="${t("Phase")}">
      ${DUEL_PHASES.map((one) => html`<li class="duel-phase${one === phase ? " is-current" : ""}"
            ${one === phase ? raw('aria-current="step"') : raw("")}>${phaseName(one)}</li>`)}
    </ol>

    <div class="duel-lives">
      ${lifeCard(mine, { mine: true, playing: myTurn, busy: state.busy })}
      ${lifeCard(theirs, { mine: false, playing: !myTurn, busy: state.busy })}
    </div>

    <!--
      The turn belongs to the one playing it: off their turn, the two controls
      that move it are inert rather than hidden — one sees what will be possible
      again, and the server refuses them anyway (Ange, 2026-09-19).

      Calling the duel off is not one of them: it sits apart, under the other
      duellist's card, where the hand moving the turn along does not pass.
    -->
    <div class="duel-actions">
      <button type="button" class="btn-showcase-primary-full is-moyen is-auto" id="btn-phase"
              ${!myTurn || phase === "end" ? raw("disabled") : raw("")}>${t("Next phase")}</button>
      <button type="button" class="btn duel-end-turn" id="btn-end-turn"
              ${myTurn ? raw("") : raw("disabled")}>${t("End the turn")}</button>
    </div>

    <div class="duel-drop-row">
      <button type="button" class="btn-action-danger-red is-petit is-auto" id="btn-drop">
        ${t("Call it off")}
      </button>
    </div>
  </section>`;
}

/**
 * Zero life points: the duel is over, and the screen says so.
 *
 * Asked for by Ange on 2026-09-19. The result is not written by the
 * application — a duel is a best of three, and only the two know what the
 * evening was — so this offers to record it, with the decks played under the
 * winner's name. And a way back, because a life total reaches zero by a
 * mistyped figure as easily as by an attack.
 */
function victoryHtml(duel: DuelDetail): SafeHtml {
  const beaten = duel.host.life === 0 ? duel.host : duel.guest;
  const winner = duel.host.life === 0 ? duel.guest : duel.host;
  return html`<section class="profile-section-card duel-victory">
    <span class="duel-victory-cup" aria-hidden="true">🏆</span>
    <h2 class="duel-victory-name">${t("{name} wins", { name: winner.player?.displayName ?? t("A duellist") })}</h2>
    <p class="legende">${t("{name} is at zero life points.", { name: beaten.player?.displayName ?? t("A duellist") })}</p>

    <div class="duel-victory-decks">
      ${[winner, beaten].map((one) => html`<div class="duel-victory-deck">
        <span class="legende">${one.player?.displayName ?? t("A duellist")}</span>
        <strong>${one.deck.name ?? t("No deck named")}</strong>
      </div>`)}
    </div>

    <div class="duel-actions">
      <button type="button" class="btn-showcase-primary-full is-moyen is-auto" id="btn-result">
        ${t("Record the result")}
      </button>
      <button type="button" class="btn" id="btn-correct">${t("Correct the life points")}</button>
      <button type="button" class="btn-action-danger-red is-petit is-auto" id="btn-drop">${t("Call it off")}</button>
    </div>
  </section>`;
}

/**
 * The coin, while it turns.
 *
 * The server draws it (`docs/ref-duels.md`); this only shows the draw happening,
 * because a result that appears instantly is a result one doubts. It stops on
 * the name the server sent.
 */
function coinHtml(state: DuelState): SafeHtml {
  const coin = state.coin;
  if (!coin) return html``;
  return html`<div class="deck-modal-backdrop is-coin"></div>
  <div class="duel-coin" role="status" aria-live="assertive">
    <span class="duel-coin-label">${coin.winner ? t("Begins") : t("Flipping the coin…")}</span>
    <strong class="duel-coin-name${coin.winner ? " is-settled" : ""}">
      ${coin.winner ?? coin.names[0]}
    </strong>
  </div>`;
}

export function detailHtml(state: DuelState): SafeHtml {
  const duel = state.open;
  if (!duel) return html`<main class="community-app-container">
    <div class="empty-state"><p class="empty-title">${state.failure ?? t("Loading…")}</p></div>
  </main>`;

  const mine = duel.isHost ? duel.host : duel.guest;
  const ready = duel.host.deck.id !== null && duel.guest.deck.id !== null;
  // A duellist at zero ends the duel: nothing is played on top of that.
  const over = duel.status === "playing" && (duel.host.life === 0 || duel.guest.life === 0);
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
        ${when(duel.status === "proposed" && !duel.isHost, html`
          <button type="button" class="btn-showcase-primary-full is-moyen is-auto" id="btn-accept">${t("Accept the duel")}</button>
          <button type="button" class="btn" id="btn-drop">${t("Decline")}</button>`)}
        ${when(duel.status === "proposed" && duel.isHost, html`
          <p class="legende">${t("Waiting for the other duellist to accept.")}</p>
          <button type="button" class="btn" id="btn-drop">${t("Cancel the invitation")}</button>`)}
        ${when(duel.status === "accepted", html`
          <button type="button" class="btn" id="btn-deck">${mine.deck.name ? t("Change my deck") : t("Choose my deck")}</button>
          <button type="button" class="btn-showcase-primary-full is-moyen is-auto" id="btn-start"
                  ${ready ? raw("") : raw("disabled")}>${t("Flip the coin and start")}</button>
          <button type="button" class="btn" id="btn-drop">${t("Call it off")}</button>`)}
      </div>
      ${when(duel.status === "accepted" && !ready,
        html`<p class="legende">${t("Both duellists choose a deck before the coin is flipped.")}</p>`)}
    </section>

    ${when(duel.status === "playing",
      over && !state.correcting ? victoryHtml(duel) : boardHtml(duel, state))}

    <!--
      The history is folded: a duel is played on the panel above, and the two
      players arrange the rest between themselves at the table. It is opened to
      settle a doubt, not to follow along.
    -->
    ${when(duel.events.length > 0, html`<details class="profile-section-card duel-log">
      <summary class="duel-log-summary">
        📜 ${t("Turn by turn")}
        <span class="muted">${t("{n} events", { n: String(duel.events.length) })}</span>
      </summary>
      <div class="admin-table-container">
        <table class="admin-table">
          <thead><tr>
            <th>${t("Turn")}</th><th>${t("Phase")}</th><th>${t("What happened")}</th><th>${t("Life points")}</th>
          </tr></thead>
          <!-- Newest first: what one looks for is what just happened. -->
          <tbody>${[...duel.events].reverse().map((event) => eventLine(duel, event))}</tbody>
        </table>
      </div>
    </details>`)}
  </main>
  ${resultModal(state)}
  ${lifeModal(state)}
  ${deckModal(state)}
  ${coinHtml(state)}`;
}

/** The deck picker, shared by the invitation and “choose my deck”. */
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

/**
 * An amount the six buttons do not offer — and a word about it.
 *
 * It takes life points from **one's own** total: the card it opens from is
 * one's own, and the server refuses anything else.
 */
function lifeModal(state: DuelState): SafeHtml {
  const life = state.life;
  const duel = state.open;
  if (!life || !duel) return html``;
  return html`<div class="deck-modal-backdrop" id="duel-modal-backdrop"></div>
  <div class="deck-modal" role="dialog" aria-modal="true" aria-labelledby="life-title">
    <div class="deck-modal-head"><h2 id="life-title">${t("My life points")}</h2></div>
    <form class="deck-modal-body" id="form-life">
      <p class="legende">${t("In the {phase}, turn {n}.", {
        phase: phaseName(duel.phase ?? "draw"), n: String(duel.turnNumber ?? 1),
      })}</p>
      <div class="bloc-champ">
        <label class="champ-libelle" for="life-amount">${t("How many")}</label>
        <input type="number" id="life-amount" class="search-input-gaming is-nue" min="1" max="99999"
               inputmode="numeric" value="${life.amount}" />
      </div>
      <div class="bloc-champ">
        <label class="champ-libelle" for="life-note">${t("What happened (optional)")}</label>
        <input type="text" id="life-note" class="search-input-gaming is-nue" maxlength="280" value="${life.note}" />
      </div>
      <div class="deck-modal-foot">
        <button type="button" class="btn" id="duel-modal-cancel">${t("Cancel")}</button>
        <button type="button" class="btn" id="btn-life-give">${t("Give back instead")}</button>
        <button type="submit" class="btn-action-danger-red is-moyen is-auto"
                ${state.busy ? raw("disabled") : raw("")}>${t("Take them")}</button>
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
