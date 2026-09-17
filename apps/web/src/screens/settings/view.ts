/**
 * The settings markup — a menu, and one panel per section.
 *
 * **Transcribed from ATEM-old** (`settings/vue.ts`), whose hierarchical design was
 * validated: a list of rows, each opening its own panel with a way back. Its
 * classes are kept as they were, so its stylesheet applies unchanged.
 *
 * Three things were deliberately not carried over:
 * - **inline `style="…"` attributes**, everywhere in the original: the content
 *   security policy refuses them, so they became classes;
 * - **a hard-coded announcement banner** (“Grand Tournoi ATEM d'Été…”), which was
 *   invented content presented as news;
 * - **French strings used as keys**: the dictionary here takes the English phrase.
 *
 * The export, import and history sections arrive with the routes they need; a row
 * leading to a panel that cannot do anything yet is the hollow affordance this
 * project refuses.
 */
import { html, raw, when, type SafeHtml } from "../../platform/ui.js";
import { locale, t } from "../../platform/i18n/index.js";
import type { SettingsState, SettingsView } from "./state.js";

/** The phrase to type before deleting the account, in the interface's language. */
export function deletionPhrase(): string {
  // Asking someone to type a formula in a language they did not choose is its own
  // small barrier — ATEM-old's rule, kept.
  return locale() === "en" ? "delete my account" : "supprimer mon compte";
}

/**
 * Are the three guards cleared?
 *
 * The phrase and the checkbox protect against the absent-minded gesture; the
 * password is what protects against someone else at the keyboard, and the server
 * requires it. The button stays inert until all three are there: an active button
 * that will answer 403 is a promise we do not keep.
 */
export function deletionReady(state: SettingsState): boolean {
  return (
    state.deletion.phrase.trim().toLowerCase() === deletionPhrase() &&
    state.deletion.password.length > 0 &&
    state.deletion.acknowledged
  );
}

const panelClass = (state: SettingsState, view: SettingsView): string =>
  `settings-view-panel${state.view === view ? " is-active" : ""}`;

function backButton(): SafeHtml {
  return html`<button type="button" class="settings-back-btn" data-target-view="root">
    <span aria-hidden="true">←</span><span>${t("Settings")}</span>
  </button>`;
}

function menuRow(view: SettingsView, icon: string, title: string, hint: string, danger = false): SafeHtml {
  return html`<button type="button" class="settings-menu-row-btn${danger ? " danger" : ""}"
          data-target-view="${view}">
    <div class="rangee">
      <span class="emblemette" aria-hidden="true">${icon}</span>
      <div>
        <strong class="valeur is-discrete">${title}</strong>
        <span class="legende">${hint}</span>
      </div>
    </div>
    <span class="emblemette is-discrete" aria-hidden="true">›</span>
  </button>`;
}

function rootPanel(state: SettingsState): SafeHtml {
  return html`<div class="${panelClass(state, "root")}">
    <h1 class="titre-section">⚙️ ${t("Settings")}</h1>
    <p class="legende">${t("Your account, your password and your data.")}</p>
    <div class="settings-menu-card-list">
      ${menuRow("account", "👤", t("Account"), t("Display name, email address and account details"))}
      ${menuRow("security", "🔐", t("Password"), t("Change the password you sign in with"))}
      ${menuRow("danger", "⚠️", t("Danger zone"), t("Erase your collection, or delete your account"), true)}
    </div>
  </div>`;
}

/**
 * The account panel.
 *
 * ATEM-old also showed the account's UUID with a copy button. It is not carried
 * over: an internal identifier is of no use to the person reading it, and a
 * button that copies it is surface with no job.
 */
function accountPanel(state: SettingsState): SafeHtml {
  const account = state.account;
  const created = account
    ? new Date(account.createdAt).toLocaleDateString(locale(), {
        day: "2-digit", month: "long", year: "numeric",
      })
    : "—";

  return html`<div class="${panelClass(state, "account")}">
    ${backButton()}
    <div class="settings-card-frame">
      <h2 class="titre-section">👤 ${t("Account")}</h2>

      <form class="bloc-champ" id="form-display-name">
        <label class="champ-libelle" for="input-display-name">${t("Display name")}</label>
        <div class="settings-detail-row">
          <input type="text" id="input-display-name" class="search-input-gaming is-nue" minlength="2"
                 maxlength="32" autocomplete="nickname" value="${account?.displayName ?? ""}" required />
          <span class="legende">#${account?.tag ?? "—"}</span>
          <button type="submit" class="btn-showcase-primary-full is-moyen is-auto">${t("Rename")}</button>
        </div>
        <p class="legende">${t("Your number stays the same unless someone already has it under the new name.")}</p>
      </form>

      <form class="bloc-champ" id="form-email">
        <label class="champ-libelle" for="input-email">${t("Email address")}</label>
        <div class="settings-detail-row">
          <input type="email" id="input-email" class="search-input-gaming is-nue" maxlength="254"
                 autocomplete="email" value="${account?.email ?? ""}" required />
          <button type="submit" class="btn-showcase-primary-full is-moyen is-auto">${t("Change")}</button>
        </div>
      </form>

      <div class="bloc-champ">
        <span class="champ-libelle">${t("Account created")}</span>
        <span class="valeur">${created}</span>
      </div>
      <div class="bloc-champ">
        <span class="champ-libelle">${t("Role")}</span>
        <span class="valeur">${account?.role === "admin" ? t("Instance administrator") : t("Duellist")}</span>
      </div>
    </div>
  </div>`;
}

function securityPanel(state: SettingsState): SafeHtml {
  return html`<div class="${panelClass(state, "security")}">
    ${backButton()}
    <div class="settings-card-frame">
      <h2 class="titre-section">🔐 ${t("Password")}</h2>
      <p class="legende">
        ${t("Changing it signs you out everywhere else. This device stays signed in.")}
      </p>
      <form id="form-password">
        <div class="bloc-champ">
          <label class="champ-libelle" for="input-current-password">${t("Current password")}</label>
          <input type="password" id="input-current-password" class="search-input-gaming is-nue"
                 autocomplete="current-password" required />
        </div>
        <div class="bloc-champ">
          <label class="champ-libelle" for="input-new-password">${t("New password")}</label>
          <input type="password" id="input-new-password" class="search-input-gaming is-nue"
                 autocomplete="new-password" required />
          <div id="password-meter-host"></div>
        </div>
        <div class="bloc-champ">
          <label class="champ-libelle" for="input-confirm-password">${t("Confirm the new password")}</label>
          <input type="password" id="input-confirm-password" class="search-input-gaming is-nue"
                 autocomplete="new-password" required />
        </div>
        <button type="submit" class="btn-showcase-primary-full is-moyen is-auto">${t("Change the password")}</button>
      </form>
    </div>
  </div>`;
}

function dangerPanel(state: SettingsState): SafeHtml {
  const count = state.ownedCount === null ? "—" : String(state.ownedCount);
  return html`<div class="${panelClass(state, "danger")}">
    ${backButton()}
    <div class="zone-danger">
      <h2 class="zone-danger-titre">⚠️ ${t("Danger zone")}</h2>
      <p class="zone-danger-avertissement">${t("The actions below are final.")}</p>

      <div class="bloc-champ">
        <h3 class="titre-menu">🗑️ ${t("Erase my collection")}</h3>
        <p class="legende-danger">
          ${t("Removes all {n} printings from your collection. Your decks are kept, and will say what they can no longer field.", { n: count })}
        </p>
        <button type="button" class="btn-action-danger-red is-moyen is-auto" id="btn-open-clear"
                ${state.ownedCount === 0 ? raw("disabled") : raw("")}>
          🗑️ ${t("Erase the collection")}
        </button>
      </div>

      <div class="bloc-champ is-suivant">
        <h3 class="titre-menu">💀 ${t("Delete my account")}</h3>
        <p class="legende-danger is-collee">
          ${t("Immediately, with no retention period: your collection, your decks, your folders and your batches disappear with it.")}
        </p>
        <button type="button" class="btn-action-danger-red is-moyen is-auto" id="btn-open-delete">
          💀 ${t("Delete my account")}
        </button>
      </div>
    </div>
  </div>`;
}

/**
 * The erase-collection window: type a word, then a delay to cancel.
 *
 * Nothing is sent until the delay runs out — that is what makes the cancel real
 * rather than an apology after the fact.
 */
function clearModal(state: SettingsState): SafeHtml {
  if (state.modal !== "clear") return html``;
  const exact = state.clearWord.trim().toLowerCase() === "collection";
  return html`<div class="deck-modal-backdrop" id="settings-modal-backdrop"></div>
  <div class="deck-modal modal-carte is-danger" role="dialog" aria-modal="true"
       aria-labelledby="clear-title">
    <div class="modal-danger-entete">
      <span class="emblemette" aria-hidden="true">⚠️</span>
      <h2 class="titre-section" id="clear-title">${t("Erase the collection")}</h2>
    </div>
    <p class="modal-danger-intro">
      ${t("This erases all {n} printings in your collection.", {
        n: state.ownedCount === null ? "—" : String(state.ownedCount),
      })}
    </p>
    <form id="form-clear" class="encadre-recopie">
      <label for="input-clear-word">${t("Type “collection” to confirm")}</label>
      <input type="text" id="input-clear-word" class="search-input-gaming is-nue" autocomplete="off"
             value="${state.clearWord}" />
      <div class="deck-modal-foot">
        <button type="button" class="btn" id="settings-modal-cancel">${t("Cancel")}</button>
        <button type="submit" class="btn-action-danger-red is-moyen is-auto" ${exact ? raw("") : raw("disabled")}>
          ${t("Erase")}
        </button>
      </div>
    </form>
  </div>`;
}

function deleteModal(state: SettingsState): SafeHtml {
  if (state.modal !== "delete") return html``;
  const phrase = deletionPhrase();
  return html`<div class="deck-modal-backdrop" id="settings-modal-backdrop"></div>
  <div class="deck-modal modal-carte is-danger" role="dialog" aria-modal="true"
       aria-labelledby="delete-title">
    <div class="modal-danger-entete">
      <span class="emblemette" aria-hidden="true">💀</span>
      <h2 class="titre-section" id="delete-title">${t("Delete my account")}</h2>
    </div>
    <form id="form-delete" class="encadre-recopie">
      <label for="input-delete-phrase">
        ${t("Type “{phrase}” to confirm", { phrase })}
      </label>
      <input type="text" id="input-delete-phrase" class="search-input-gaming is-nue" autocomplete="off"
             value="${state.deletion.phrase}" />
      <label for="input-delete-password">${t("Your password")}</label>
      <input type="password" id="input-delete-password" class="search-input-gaming is-nue"
             autocomplete="current-password" value="${state.deletion.password}" />
      <label class="menu-check">
        <input type="checkbox" id="input-delete-ack"${state.deletion.acknowledged ? raw(" checked") : raw("")} />
        ${t("I understand that this cannot be undone.")}
      </label>
      <div class="deck-modal-foot">
        <button type="button" class="btn" id="settings-modal-cancel">${t("Cancel")}</button>
        <button type="submit" class="btn-action-danger-red is-moyen is-auto"
                ${deletionReady(state) ? raw("") : raw("disabled")}>
          ${t("Delete my account")}
        </button>
      </div>
    </form>
  </div>`;
}

/** The pending erase, with its countdown and the way back. */
function undoBanner(state: SettingsState): SafeHtml {
  return when(
    state.clearCountdown !== null,
    html`<div class="banner banner-err" role="status" id="clear-undo">
      <span>${t("The collection will be erased in {s} s.", { s: String(state.clearCountdown ?? 0) })}</span>
      <button type="button" class="btn" id="btn-cancel-clear">${t("Cancel")}</button>
    </div>`,
  );
}

export function settingsHtml(state: SettingsState): SafeHtml {
  return html`<main class="settings-hierarchical-container">
    ${undoBanner(state)}
    ${rootPanel(state)}
    ${accountPanel(state)}
    ${securityPanel(state)}
    ${dangerPanel(state)}
    ${clearModal(state)}
    ${deleteModal(state)}
  </main>`;
}
