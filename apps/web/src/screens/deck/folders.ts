/**
 * Folders, screen side — filing, and nothing else.
 *
 * We navigate **one level at a time**, as in a file explorer: you are
 * somewhere, you see what is there, you go down or back up. That is the shape
 * ATEM-old had ended up returning to after unfolding the whole tree at once.
 *
 * **What is greyed out here is refused over there**: impossible destinations
 * come from `folderCanHost`, the function the server calls to refuse. One rule,
 * two uses.
 */
import { folderCanHost, folderIsInside, type FolderNode } from "@atem/shared";
import { html, raw, when, type SafeHtml } from "../../platform/ui.js";
import { t } from "../../platform/i18n/index.js";
import type { DeckFolder, DeckMoving, DeckState, DeckSummary } from "./state.js";

/** The tree reduced to its topology, as the shared rules read it. */
const topology = (folders: DeckFolder[]): FolderNode[] =>
  folders.map((folder) => ({ id: folder.id, parentId: folder.parentId }));

const folderById = (state: DeckState, id: string | null): DeckFolder | null =>
  id === null ? null : (state.folders.find((folder) => folder.id === id) ?? null);

/** The folders filed directly inside this one. */
export const childFolders = (state: DeckState, parentId: string | null): DeckFolder[] =>
  state.folders
    .filter((folder) => folder.parentId === parentId)
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));

/** The decks filed directly inside this one. */
export const decksIn = (state: DeckState, folderId: string | null): DeckSummary[] =>
  state.decks
    .filter((deck) => deck.folderId === folderId)
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));

/**
 * What the search shows.
 *
 * **It crosses folders**, unlike ATEM-old which only filtered the current
 * level. Searching “dragon” and finding nothing because you are in the wrong
 * folder is a wrong answer to a simple question. The path is then displayed
 * under each deck, to say where it comes from.
 */
export const searchDecks = (state: DeckState, query: string): DeckSummary[] => {
  const q = query.trim().toLowerCase();
  return state.decks
    .filter((deck) => deck.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
};

/** A deck's path, for the search — “Meta / Tier 1”, or nothing. */
export const deckFolderPath = (state: DeckState, deck: DeckSummary): string =>
  folderById(state, deck.folderId)?.path.join(" / ") ?? "";

/**
 * The breadcrumb, up to the current level.
 *
 * Each segment leads back to its level: without that, going up two folders
 * would need two round trips through the “..” card.
 */
export function breadcrumbHtml(state: DeckState): SafeHtml {
  const current = folderById(state, state.folderId);
  const path = current?.path ?? [];
  // The identifiers of the folders crossed, from the root down to here.
  const steps: { id: string; name: string }[] = [];
  let cursor: DeckFolder | null = current;
  while (cursor) {
    steps.unshift({ id: cursor.id, name: cursor.name });
    cursor = folderById(state, cursor.parentId);
  }

  return html`<nav class="folder-path" aria-label="${t("Location")}">
    <button type="button" class="folder-path-step" data-goto-folder="" data-drop=""
            ${state.folderId === null ? raw(' aria-current="page"') : raw("")}>
      ${t("Root")}
    </button>
    ${steps.map(
      (step, rank) => html`<span class="folder-path-sep" aria-hidden="true">/</span>
        <button type="button" class="folder-path-step" data-goto-folder="${step.id}"
                data-drop="${step.id}"
                ${rank === path.length - 1 ? raw(' aria-current="page"') : raw("")}>
          ${step.name}
        </button>`,
    )}
  </nav>`;
}

/** The “⋯” menu, and what it offers. */
function menuHtml(state: DeckState, id: string, actions: SafeHtml): SafeHtml {
  const open = state.menu === id;
  return html`<div class="folder-menu-anchor">
    <button type="button" class="icon-btn folder-menu-btn" data-menu="${id}"
            aria-expanded="${String(open)}" aria-label="${t("Actions")}">⋯</button>
    ${when(open, html`<div class="folder-ctx-menu" role="menu">${actions}</div>`)}
  </div>`;
}

const folderActions = (id: string): SafeHtml => html`
  <button type="button" class="menu-item" role="menuitem" data-folder-rename="${id}">
    ${t("Rename")}
  </button>
  <button type="button" class="menu-item" role="menuitem" data-folder-move="${id}">
    ${t("Move…")}
  </button>
  <button type="button" class="menu-item menu-item-danger" role="menuitem" data-folder-delete="${id}">
    ${t("Delete")}
  </button>`;

/** A deck's menu: it only offers filing, the rest is in the workshop. */
export const deckMenu = (state: DeckState, id: string): SafeHtml =>
  menuHtml(
    state,
    id,
    html`<button type="button" class="menu-item" role="menuitem" data-deck-move="${id}">
      ${t("Move…")}
    </button>`,
  );

/**
 * What a folder holds, said without having to open it.
 *
 * Both plural forms are spelled out in full: “1 deck(s)” is the mark of a
 * translation nobody reread, and our dictionary takes the phrase as its key —
 * it has no plural rule to apply.
 */
function folderMeta(state: DeckState, folder: DeckFolder): string {
  const folders = childFolders(state, folder.id).length;
  const decks = decksIn(state, folder.id).length;
  if (folders === 0 && decks === 0) return t("Empty");

  const pieces: string[] = [];
  if (folders > 0) {
    pieces.push(folders === 1 ? t("1 folder") : t("{n} folders", { n: folders }));
  }
  if (decks > 0) {
    pieces.push(decks === 1 ? t("1 deck") : t("{n} decks", { n: decks }));
  }
  return pieces.join(" · ");
}

export function folderTile(state: DeckState, folder: DeckFolder): SafeHtml {
  return html`<li class="folder-tile-li" data-drop="${folder.id}">
    <div class="folder-tile">
      <button type="button" class="folder-open" data-goto-folder="${folder.id}"
              draggable="true" data-drag-folder="${folder.id}">
        <span class="folder-ico" aria-hidden="true">📁</span>
        <strong class="folder-name">${folder.name}</strong>
        <span class="muted folder-meta">${folderMeta(state, folder)}</span>
      </button>
      ${menuHtml(state, folder.id, folderActions(folder.id))}
    </div>
  </li>`;
}

export function folderRow(state: DeckState, folder: DeckFolder): SafeHtml {
  return html`<li class="drive-row" data-drop="${folder.id}">
    <button type="button" class="drive-main drive-folder" data-goto-folder="${folder.id}"
            draggable="true" data-drag-folder="${folder.id}">
      <span class="drive-ico" aria-hidden="true">📁</span>
      <span class="drive-text"><strong class="drive-name">${folder.name}</strong></span>
      <span class="muted drive-meta">${folderMeta(state, folder)}</span>
    </button>
    ${menuHtml(state, folder.id, folderActions(folder.id))}
  </li>`;
}

/**
 * The “..” card, which goes up one level.
 *
 * It carries the parent folder's name rather than a bare “..”: knowing where
 * you are going beats knowing that you are going up.
 */
export function parentTile(state: DeckState): SafeHtml {
  const current = folderById(state, state.folderId);
  if (!current) return html``;
  const parent = folderById(state, current.parentId);
  return html`<li class="folder-tile-li" data-drop="${parent?.id ?? ""}">
    <div class="folder-tile folder-tile-parent">
      <button type="button" class="folder-open" data-goto-folder="${parent?.id ?? ""}">
        <span class="folder-ico" aria-hidden="true">📁</span>
        <strong class="folder-name">..</strong>
        <span class="muted folder-meta">${parent?.name ?? t("Root")}</span>
      </button>
    </div>
  </li>`;
}

/** The same way up, as a row: list view must not force you to aim at the breadcrumb. */
export function parentRow(state: DeckState): SafeHtml {
  const current = folderById(state, state.folderId);
  if (!current) return html``;
  const parent = folderById(state, current.parentId);
  return html`<li class="drive-row" data-drop="${parent?.id ?? ""}">
    <button type="button" class="drive-main drive-folder" data-goto-folder="${parent?.id ?? ""}">
      <span class="drive-ico" aria-hidden="true">📁</span>
      <span class="drive-text"><strong class="drive-name">..</strong></span>
      <span class="muted drive-meta">${parent?.name ?? t("Root")}</span>
    </button>
  </li>`;
}

/**
 * The banner of the move under way.
 *
 * It says **what** is being moved and **where** it would land, and it offers
 * only two gestures. In between, you navigate as usual: it is the current
 * screen that designates the destination.
 *
 * The button greys out along with the refusal's sentence — the same one the
 * server would return, since it is the same rule. Greyed out and not hidden: a
 * button that disappears suggests the mode has stopped.
 */
export function moveBannerHtml(state: DeckState): SafeHtml {
  const moving = state.moving;
  if (!moving) return html``;

  const what =
    moving.kind === "folder"
      ? (folderById(state, moving.id)?.name ?? "")
      : (state.decks.find((deck) => deck.id === moving.id)?.name ?? "");
  const here = folderById(state, state.folderId);
  const refusal = dropRefusal(state, moving, state.folderId);

  return html`<div class="move-banner" role="status">
    <span class="move-banner-what">
      ${t("Moving “{name}”", { name: what })}
      <span class="muted">${t("to {where}", { where: here?.path.join(" / ") ?? t("Root") })}</span>
    </span>
    ${when(refusal !== null, html`<span class="move-banner-why">${refusal ?? ""}</span>`)}
    <span class="move-banner-actions">
      <button type="button" class="btn" id="move-cancel">${t("Cancel")}</button>
      <button type="button" class="btn btn-primary" id="move-here"
              ${refusal === null ? raw("") : raw("disabled")}>${t("Move here")}</button>
    </span>
  </div>`;
}

/**
 * Why this drop is impossible — or `null` when it is not.
 *
 * The sentences are **the server's**, word for word: it would refuse with them,
 * and reading two different wordings for the same refusal would make one doubt
 * it is the same rule.
 */
export function dropRefusal(
  state: DeckState,
  moving: DeckMoving,
  destination: string | null,
): string | null {
  if (moving.kind === "deck") {
    const deck = state.decks.find((d) => d.id === moving.id);
    return deck && deck.folderId === destination ? t("Already here") : null;
  }

  const folder = folderById(state, moving.id);
  if (!folder) return null;
  if (folder.parentId === destination) return t("Already here");
  if (destination === null) return null;
  if (destination === moving.id) return t("A folder cannot be filed inside itself.");

  const tree = topology(state.folders);
  if (folderIsInside(tree, destination, moving.id)) {
    return t("A folder cannot be filed inside one of its own.");
  }
  if (!folderCanHost(tree, moving.id, destination)) {
    return t("That folder and its contents would go past the last level.");
  }
  return null;
}

/** The window's title and body, according to what it asks for. */
function modalBody(state: DeckState): { title: string; body: SafeHtml; confirm: string } {
  const modal = state.modal;
  if (!modal) return { title: "", body: html``, confirm: "" };

  switch (modal.kind) {
    case "new-deck":
      return {
        title: t("New deck"),
        confirm: t("Create"),
        // No destination to choose: the deck is born where you are looking, and
        // moves afterwards like everything else.
        body: html`<label class="menu-field">
          <span>${t("Deck name")}</span>
          <input type="text" id="modal-name" maxlength="60" placeholder="${t("Unique name…")}" />
        </label>`,
      };
    case "new-folder":
      return {
        title: t("New folder"),
        confirm: t("Create"),
        body: html`<label class="menu-field">
          <span>${t("Folder name")}</span>
          <input type="text" id="modal-name" maxlength="60" placeholder="${t("Meta, Tryouts…")}" />
        </label>`,
      };
    case "rename-folder":
      return {
        title: t("Rename the folder"),
        confirm: t("Rename"),
        body: html`<label class="menu-field">
          <span>${t("Folder name")}</span>
          <input type="text" id="modal-name" maxlength="60"
                 value="${folderById(state, modal.id)?.name ?? ""}" />
        </label>`,
      };
  }
}

/**
 * The window itself.
 *
 * It replaces the `window.prompt` of deck creation: a native prompt has neither
 * the application's style nor room for a second field — and on a phone, it
 * opens at the top of the screen, far from the thumb.
 */
export function modalHtml(state: DeckState): SafeHtml {
  if (!state.modal) return html``;
  const { title, body, confirm } = modalBody(state);

  return html`<div class="deck-modal-backdrop" id="modal-backdrop"></div>
  <div class="deck-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <div class="deck-modal-head">
      <h2 id="modal-title">${title}</h2>
      <button type="button" class="icon-btn" id="modal-close" aria-label="${t("Close")}">✕</button>
    </div>
    <div class="deck-modal-body">${body}</div>
    <div class="deck-modal-foot">
      <button type="button" class="btn" id="modal-cancel">${t("Cancel")}</button>
      <button type="button" class="btn btn-primary" id="modal-ok">${confirm}</button>
    </div>
  </div>`;
}
