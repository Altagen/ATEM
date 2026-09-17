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
import { CSV_EXPORT_FORMATS, type CsvExportFormat } from "@atem/shared";
import { html, raw, when, type SafeHtml } from "../../platform/ui.js";
import { locale, t } from "../../platform/i18n/index.js";
import type { ImportLineError } from "@atem/shared";
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
      ${menuRow("export", "⬇️", t("Export my collection"), t("Every card in a CSV file — ATEM, ScanFlip or Cardmarket"))}
      ${menuRow("import", "⬆️", t("Import a collection"), t("Read a file from ATEM, ScanFlip or Cardmarket — merging or replacing"))}
      ${menuRow("history", "📜", t("Import history"), t("The files you imported lately, and what each one did"))}
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

/**
 * What each format is for — ATEM-old's descriptions, as dictionary phrases.
 *
 * Read at display time rather than at module load: declared once, they would
 * freeze the language of the first render.
 */
function formatHint(format: CsvExportFormat): string {
  switch (format) {
    case "atem":
      return t("The native format. ATEM imports it back without loss: the set code comes first because it identifies the printed copy.");
    case "scanflip":
      return t("Same data, ScanFlip headers. The passcode is kept, so a card is found even when its set code differs between printings.");
    case "cardmarket":
      return t("For listing cards for sale. The language is spelled out and the passcode is dropped: Cardmarket identifies cards by set number.");
  }
}

/**
 * The export panel.
 *
 * The download is a plain link to the route, not a script building a blob: the
 * server writes the BOM a spreadsheet needs, and a link is also what survives a
 * right-click “save as”. ATEM-old ended the panel by printing the route's URL —
 * developer plumbing on a player's screen, and a wrong URL at that — which is
 * not carried over.
 */
function exportPanel(state: SettingsState): SafeHtml {
  const spec = CSV_EXPORT_FORMATS.find((format) => format.id === state.exportFormat)!;
  return html`<div class="${panelClass(state, "export")}">
    ${backButton()}
    <div class="bloc-champ">
      <h2 class="titre-section">⬇️ ${t("Export my collection")}</h2>
      <p class="legende">${t("Every card, with its quantity, in a file other tools can read.")}</p>
    </div>

    <p class="export-lead">
      ${state.ownedCount === null
        ? html`<span class="legende">${t("Reading the collection…")}</span>`
        : html`<strong>${state.ownedCount === 1
            ? t("1 printing")
            : t("{n} printings", { n: state.ownedCount })}</strong>`}
    </p>

    <div class="bloc-champ">
      <span class="champ-libelle">${t("File format")}</span>
      <div class="radio-cards">
        ${CSV_EXPORT_FORMATS.map(
          (format) => html`<label class="radio-card${state.exportFormat === format.id ? " is-selected" : ""}">
            <input type="radio" name="export-format" value="${format.id}"
                   ${state.exportFormat === format.id ? raw("checked") : raw("")} />
            <span>
              <span class="radio-card-label">${format.label}</span>
              <span class="radio-card-hint">${formatHint(format.id)}</span>
            </span>
          </label>`,
        )}
      </div>
    </div>

    <div class="bloc-champ">
      <span class="champ-libelle">${t("Columns")} — <code>${spec.filename}</code></span>
      <pre class="export-preview">${spec.columns.join(spec.separator)}</pre>
    </div>

    <a class="btn-showcase-primary-full is-moyen is-auto" id="btn-export-run"
       href="/api/collection/export?format=${state.exportFormat}" download="${spec.filename}">
      ⬇️ ${t("Download")}
    </a>
  </div>`;
}

/**
 * A line's error, in the reader's words.
 *
 * The file reader reports codes, the server's collection service reports
 * sentences; both reach the same list, so both are translated here. An unknown
 * code is shown as it is rather than hidden behind a vague sentence.
 */
function importErrorText(error: ImportLineError): string {
  switch (error.error) {
    case "empty_file": return t("The file is empty.");
    case "missing_column_set_code": return t("No set code column was found in the header.");
    case "empty_set_code": return t("This line has no set code.");
    case "set_code_too_long": return t("This set code is too long.");
    case "quantity_too_large": return t("The quantity is above 1000.");
    case "note_too_long": return t("The note is too long.");
    case "invalid_json": return t("The file is not valid JSON.");
    case "expected_array_or_lignes": return t("The JSON holds no list of cards.");
    default: return t(error.error);
  }
}

function errorList(errors: ImportLineError[]): SafeHtml {
  return when(
    errors.length > 0,
    html`<ul class="import-errors">
      ${errors.slice(0, 50).map(
        (error) => html`<li>
          ${error.line > 0 ? t("Line {n}", { n: error.line }) : t("Collection")}${error.setCode ? html` · <code>${error.setCode}</code>` : ""}
          — ${importErrorText(error)}
        </li>`,
      )}
    </ul>`,
  );
}

/**
 * The import panel.
 *
 * The file is **read in the browser first**, with the very parser the server
 * uses, so the panel says how many lines it will import and which it cannot read
 * before anything is sent. ATEM-old counted the lines by splitting on line breaks,
 * which miscounts as soon as a note spans two — and showed nothing of the errors
 * until after the import.
 *
 * Not carried over: its progress line (“sending x / y lines”), which described
 * sending line by line — the file goes in one request here — and the route's URL
 * printed at the bottom.
 */
function importPanel(state: SettingsState): SafeHtml {
  const file = state.importFile;
  return html`<div class="${panelClass(state, "import")}">
    ${backButton()}
    <div class="bloc-champ">
      <h2 class="titre-section">⬆️ ${t("Import a collection")}</h2>
      <p class="legende">${t("A CSV file made by ATEM, ScanFlip or Cardmarket, or a JSON scanlist export.")}</p>
    </div>

    <div class="bloc-champ">
      <span class="champ-libelle">${t("File")}</span>
      <!--
        The browser's own file field is kept — it is what opens the picker and what
        a keyboard reaches — but not shown: it writes “Choose File / No file
        chosen” in the browser's language, and after a repaint it claimed no file
        was chosen right above the summary naming it. The label is ours.
      -->
      <input type="file" id="import-file" class="import-file-input"
             accept=".csv,.json,text/csv,application/json,text/plain"
             ${state.importBusy ? raw("disabled") : raw("")} />
      <label for="import-file" class="btn import-file-button">
        📄 ${file ? t("Choose another file") : t("Choose a file")}
      </label>
      <p class="legende">${t("Headers are recognised by their usual names — set_code, Card Number, QTY… Only the set code column is required.")}</p>
    </div>

    <div class="bloc-champ">
      <span class="champ-libelle">${t("What to do with the cards you already own")}</span>
      <div class="radio-cards">
        <label class="radio-card${state.importMode === "merge" ? " is-selected" : ""}">
          <input type="radio" name="import-mode" value="merge" ${state.importMode === "merge" ? raw("checked") : raw("")} />
          <span>
            <span class="radio-card-label">${t("Merge")}</span>
            <span class="radio-card-hint">${t("The file's cards take the quantity it gives. The ones it does not mention stay as they are.")}</span>
          </span>
        </label>
        <label class="radio-card${state.importMode === "replace" ? " is-selected" : ""}">
          <input type="radio" name="import-mode" value="replace" ${state.importMode === "replace" ? raw("checked") : raw("")} />
          <span>
            <span class="radio-card-label">${t("Replace")}</span>
            <span class="radio-card-hint">${t("The collection becomes the file. Everything it does not mention goes back to zero copies.")}</span>
          </span>
        </label>
      </div>
    </div>

    <div class="import-summary">
      ${file
        ? html`<p class="export-lead">
            <strong>${file.name}</strong> ·
            ${(file.preview.rows.length) === 1 ? t("1 card to import") : t("{n} cards to import", { n: file.preview.rows.length })}
            ${when(file.preview.errors.length > 0, html` · ${(file.preview.errors.length) === 1 ? t("1 unreadable") : t("{n} unreadable", { n: file.preview.errors.length })}`)}
          </p>
          ${errorList(file.preview.errors)}
          ${when(state.importMode === "replace",
            html`<p class="legende-danger">${t("In Replace mode, every card this file does not mention goes back to zero copies.")}</p>`)}`
        : html`<p class="legende">${t("No file read yet.")}</p>`}
    </div>

    <button type="button" class="btn-showcase-primary-full is-moyen is-auto" id="btn-import-run"
            ${file && file.preview.rows.length > 0 && !state.importBusy ? raw("") : raw("disabled")}>
      ${state.importBusy ? t("Importing…") : html`⬆️ ${t("Import")}`}
    </button>

    ${when(state.importResult !== null, html`<div class="import-summary" id="import-report" role="status">
      <p class="export-lead">
        <strong>${(state.importResult?.imported ?? 0) === 1 ? t("1 imported") : t("{n} imported", { n: state.importResult?.imported ?? 0 })}</strong>
        ${when((state.importResult?.removed ?? 0) > 0, html` · ${(state.importResult?.removed ?? 0) === 1 ? t("1 back to zero") : t("{n} back to zero", { n: state.importResult?.removed ?? 0 })}`)}
        ${when((state.importResult?.failed ?? 0) > 0, html` · ${(state.importResult?.failed ?? 0) === 1 ? t("1 in error") : t("{n} in error", { n: state.importResult?.failed ?? 0 })}`)}
      </p>
      ${errorList(state.importResult?.errors ?? [])}
    </div>`)}
  </div>`;
}

/** The history panel — the server's record, so the same on every device. */
function historyPanel(state: SettingsState): SafeHtml {
  const items = state.history;
  return html`<div class="${panelClass(state, "history")}">
    ${backButton()}
    <div class="bloc-champ">
      <h2 class="titre-section">📜 ${t("Import history")}</h2>
      <p class="legende">${t("Your latest imports, whichever device you made them from.")}</p>
    </div>
    ${items === null
      ? html`<p class="legende">${t("Loading…")}</p>`
      : items.length === 0
        ? html`<p class="legende">${t("No import yet. This history fills up with the first file you import.")}</p>`
        : html`<div class="admin-table-container">
            <table class="admin-table">
              <thead>
                <tr><th>${t("File")}</th><th>${t("Mode")}</th><th>${t("Date")}</th><th>${t("Result")}</th></tr>
              </thead>
              <tbody>
                ${items.map((item) => html`<tr>
                  <td data-col="${t("File")}"><strong>${item.filename}</strong></td>
                  <td data-col="${t("Mode")}">${item.mode === "merge" ? t("Merge") : t("Replace")}</td>
                  <td data-col="${t("Date")}">${new Date(item.createdAt).toLocaleString(locale())}</td>
                  <td data-col="${t("Result")}">
                    <span>
                    <span class="etat is-ok">${(item.imported) === 1 ? t("1 imported") : t("{n} imported", { n: item.imported })}</span>
                    ${when(item.removed > 0, html` · ${(item.removed) === 1 ? t("1 back to zero") : t("{n} back to zero", { n: item.removed })}`)}
                    ${when(item.failed > 0, html` · ${(item.failed) === 1 ? t("1 in error") : t("{n} in error", { n: item.failed })}`)}</span>
                  </td>
                </tr>`)}
              </tbody>
            </table>
          </div>`}
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
          ${state.ownedCount === 1
            ? t("Removes the only printing in your collection. Your decks are kept, and will say what they can no longer field.")
            : t("Removes all {n} printings from your collection. Your decks are kept, and will say what they can no longer field.", { n: count })}
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
      ${state.ownedCount === 1
        ? t("This erases the only printing in your collection.")
        : t("This erases all {n} printings in your collection.", {
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
    ${exportPanel(state)}
    ${importPanel(state)}
    ${historyPanel(state)}
    ${dangerPanel(state)}
    ${clearModal(state)}
    ${deleteModal(state)}
  </main>`;
}
