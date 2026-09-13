/**
 * Les dossiers, côté écran — le rangement, et rien d'autre.
 *
 * On navigue **un étage à la fois**, comme dans un explorateur de fichiers :
 * on est quelque part, on voit ce qui s'y trouve, on descend ou l'on remonte.
 * C'est la forme à laquelle ATEM-old avait fini par revenir après avoir déplié
 * tout l'arbre d'un coup.
 *
 * **Ce qui est grisé ici est refusé là-bas** : les destinations impossibles
 * viennent de `folderCanHost`, la fonction que le serveur appelle pour refuser.
 * Une seule règle, deux usages.
 */
import { folderCanHost, folderIsInside, type FolderNode } from "@atem/shared";
import { html, raw, when, type SafeHtml } from "../../platform/ui.js";
import { t } from "../../platform/i18n/index.js";
import type { DeckFolder, DeckMoving, DeckState, DeckSummary } from "./state.js";

/** L'arbre réduit à sa topologie, tel que les règles partagées le lisent. */
const topologie = (folders: DeckFolder[]): FolderNode[] =>
  folders.map((folder) => ({ id: folder.id, parentId: folder.parentId }));

const folderById = (state: DeckState, id: string | null): DeckFolder | null =>
  id === null ? null : (state.folders.find((folder) => folder.id === id) ?? null);

/** Les dossiers rangés directement dans celui-ci. */
export const childFolders = (state: DeckState, parentId: string | null): DeckFolder[] =>
  state.folders
    .filter((folder) => folder.parentId === parentId)
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));

/** Les decks rangés directement dans celui-ci. */
export const decksIn = (state: DeckState, folderId: string | null): DeckSummary[] =>
  state.decks
    .filter((deck) => deck.folderId === folderId)
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));

/**
 * Ce que la recherche montre.
 *
 * **Elle traverse les dossiers**, contrairement à ATEM-old qui ne filtrait que
 * l'étage courant. Chercher « dragon » et ne rien trouver parce qu'on est dans
 * le mauvais dossier est une réponse fausse à une question simple. Le chemin
 * s'affiche alors sous chaque deck, pour dire d'où il sort.
 */
export const searchDecks = (state: DeckState, query: string): DeckSummary[] => {
  const q = query.trim().toLowerCase();
  return state.decks
    .filter((deck) => deck.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
};

/** Le chemin d'un deck, pour la recherche — « Meta / Tier 1 », ou rien. */
export const deckFolderPath = (state: DeckState, deck: DeckSummary): string =>
  folderById(state, deck.folderId)?.path.join(" / ") ?? "";

/**
 * Le fil d'Ariane, jusqu'à l'étage courant.
 *
 * Chaque segment ramène à son étage : sans ça, remonter de deux dossiers
 * demanderait deux allers-retours par la carte « .. ».
 */
export function breadcrumbHtml(state: DeckState): SafeHtml {
  const courant = folderById(state, state.folderId);
  const chemin = courant?.path ?? [];
  // Les identifiants des dossiers traversés, de la racine jusqu'ici.
  const étapes: { id: string; name: string }[] = [];
  let curseur: DeckFolder | null = courant;
  while (curseur) {
    étapes.unshift({ id: curseur.id, name: curseur.name });
    curseur = folderById(state, curseur.parentId);
  }

  return html`<nav class="folder-path" aria-label="${t("Emplacement")}">
    <button type="button" class="folder-path-step" data-goto-folder="" data-drop=""
            ${state.folderId === null ? raw(' aria-current="page"') : raw("")}>
      ${t("Racine")}
    </button>
    ${étapes.map(
      (étape, rang) => html`<span class="folder-path-sep" aria-hidden="true">/</span>
        <button type="button" class="folder-path-step" data-goto-folder="${étape.id}"
                data-drop="${étape.id}"
                ${rang === chemin.length - 1 ? raw(' aria-current="page"') : raw("")}>
          ${étape.name}
        </button>`,
    )}
  </nav>`;
}

/** Le menu « ⋯ », et ce qu'il propose. */
function menuHtml(state: DeckState, id: string, actions: SafeHtml): SafeHtml {
  const ouvert = state.menu === id;
  return html`<div class="folder-menu-anchor">
    <button type="button" class="icon-btn folder-menu-btn" data-menu="${id}"
            aria-expanded="${String(ouvert)}" aria-label="${t("Actions")}">⋯</button>
    ${when(ouvert, html`<div class="folder-ctx-menu" role="menu">${actions}</div>`)}
  </div>`;
}

const folderActions = (id: string): SafeHtml => html`
  <button type="button" class="menu-item" role="menuitem" data-folder-rename="${id}">
    ${t("Renommer")}
  </button>
  <button type="button" class="menu-item" role="menuitem" data-folder-move="${id}">
    ${t("Déplacer…")}
  </button>
  <button type="button" class="menu-item menu-item-danger" role="menuitem" data-folder-delete="${id}">
    ${t("Supprimer")}
  </button>`;

/** Le menu d'un deck : il ne propose que le rangement, le reste est dans l'atelier. */
export const deckMenu = (state: DeckState, id: string): SafeHtml =>
  menuHtml(
    state,
    id,
    html`<button type="button" class="menu-item" role="menuitem" data-deck-move="${id}">
      ${t("Déplacer…")}
    </button>`,
  );

/**
 * Ce qu'un dossier contient, dit sans avoir à l'ouvrir.
 *
 * Les deux formes du pluriel sont écrites en toutes lettres : « 1 deck(s) » est
 * la marque d'une traduction qui n'a pas été relue, et notre dictionnaire prend
 * la phrase française pour clé — il n'a pas de règle de pluriel à appliquer.
 */
function folderMeta(state: DeckState, folder: DeckFolder): string {
  const dossiers = childFolders(state, folder.id).length;
  const decks = decksIn(state, folder.id).length;
  if (dossiers === 0 && decks === 0) return t("Vide");

  const morceaux: string[] = [];
  if (dossiers > 0) {
    morceaux.push(dossiers === 1 ? t("1 dossier") : t("{n} dossiers", { n: dossiers }));
  }
  if (decks > 0) {
    morceaux.push(decks === 1 ? t("1 deck") : t("{n} decks", { n: decks }));
  }
  return morceaux.join(" · ");
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
 * La case « .. », qui remonte d'un étage.
 *
 * Elle porte le nom du dossier parent plutôt qu'un simple « .. » : savoir où
 * l'on va vaut mieux que savoir qu'on remonte.
 */
export function parentTile(state: DeckState): SafeHtml {
  const courant = folderById(state, state.folderId);
  if (!courant) return html``;
  const parent = folderById(state, courant.parentId);
  return html`<li class="folder-tile-li" data-drop="${parent?.id ?? ""}">
    <div class="folder-tile folder-tile-parent">
      <button type="button" class="folder-open" data-goto-folder="${parent?.id ?? ""}">
        <span class="folder-ico" aria-hidden="true">📁</span>
        <strong class="folder-name">..</strong>
        <span class="muted folder-meta">${parent?.name ?? t("Racine")}</span>
      </button>
    </div>
  </li>`;
}

/** La même remontée, en rangée : la vue liste ne doit pas obliger à viser le fil. */
export function parentRow(state: DeckState): SafeHtml {
  const courant = folderById(state, state.folderId);
  if (!courant) return html``;
  const parent = folderById(state, courant.parentId);
  return html`<li class="drive-row" data-drop="${parent?.id ?? ""}">
    <button type="button" class="drive-main drive-folder" data-goto-folder="${parent?.id ?? ""}">
      <span class="drive-ico" aria-hidden="true">📁</span>
      <span class="drive-text"><strong class="drive-name">..</strong></span>
      <span class="muted drive-meta">${parent?.name ?? t("Racine")}</span>
    </button>
  </li>`;
}

/**
 * Le bandeau du déplacement en cours.
 *
 * Il dit **ce** qu'on déplace et **où** on le poserait, et il ne propose que
 * deux gestes. Entre les deux, on navigue comme d'habitude : c'est l'écran
 * courant qui désigne la destination.
 *
 * Le bouton se grise avec la phrase du refus — la même que le serveur rendrait,
 * puisque c'est la même règle. Grisé et non caché : un bouton qui disparaît
 * laisse croire que le mode s'est arrêté.
 */
export function moveBannerHtml(state: DeckState): SafeHtml {
  const moving = state.moving;
  if (!moving) return html``;

  const quoi =
    moving.kind === "folder"
      ? (folderById(state, moving.id)?.name ?? "")
      : (state.decks.find((deck) => deck.id === moving.id)?.name ?? "");
  const ici = folderById(state, state.folderId);
  const refus = refusDeDeposer(state, moving, state.folderId);

  return html`<div class="move-banner" role="status">
    <span class="move-banner-what">
      ${t("Déplacement de « {nom} »", { nom: quoi })}
      <span class="muted">${t("vers {où}", { où: ici?.path.join(" / ") ?? t("Racine") })}</span>
    </span>
    ${when(refus !== null, html`<span class="move-banner-why">${refus ?? ""}</span>`)}
    <span class="move-banner-actions">
      <button type="button" class="btn" id="move-cancel">${t("Annuler")}</button>
      <button type="button" class="btn btn-primary" id="move-here"
              ${refus === null ? raw("") : raw("disabled")}>${t("Déplacer ici")}</button>
    </span>
  </div>`;
}

/**
 * Pourquoi ce dépôt est impossible — ou `null` s'il ne l'est pas.
 *
 * Les phrases sont **celles du serveur**, mot pour mot : il refuserait avec
 * elles, et lire deux formulations différentes pour un même refus ferait douter
 * qu'il s'agisse de la même règle.
 */
export function refusDeDeposer(
  state: DeckState,
  moving: DeckMoving,
  destination: string | null,
): string | null {
  if (moving.kind === "deck") {
    const deck = state.decks.find((d) => d.id === moving.id);
    return deck && deck.folderId === destination ? t("Il est déjà rangé ici.") : null;
  }

  const dossier = folderById(state, moving.id);
  if (!dossier) return null;
  if (dossier.parentId === destination) return t("Il est déjà rangé ici.");
  if (destination === null) return null;
  if (destination === moving.id) return t("Un dossier ne se range pas dans lui-même.");

  const arbre = topologie(state.folders);
  if (folderIsInside(arbre, destination, moving.id)) {
    return t("Un dossier ne se range pas dans l'un des siens.");
  }
  if (!folderCanHost(arbre, moving.id, destination)) {
    return t("Ce dossier et ce qu'il contient dépasseraient le dernier étage.");
  }
  return null;
}

/** Le titre et le corps de la fenêtre, selon ce qu'elle demande. */
function modalBody(state: DeckState): { titre: string; corps: SafeHtml; valider: string } {
  const modal = state.modal;
  if (!modal) return { titre: "", corps: html``, valider: "" };

  switch (modal.kind) {
    case "new-deck":
      return {
        titre: t("Nouveau deck"),
        valider: t("Créer"),
        // Pas de destination à choisir : le deck naît là où l'on regarde, et
        // se déplace ensuite comme tout le reste.
        corps: html`<label class="menu-field">
          <span>${t("Nom du deck")}</span>
          <input type="text" id="modal-name" maxlength="60" placeholder="${t("Nom unique…")}" />
        </label>`,
      };
    case "new-folder":
      return {
        titre: t("Nouveau dossier"),
        valider: t("Créer"),
        corps: html`<label class="menu-field">
          <span>${t("Nom du dossier")}</span>
          <input type="text" id="modal-name" maxlength="60" placeholder="${t("Meta, Essais…")}" />
        </label>`,
      };
    case "rename-folder":
      return {
        titre: t("Renommer le dossier"),
        valider: t("Renommer"),
        corps: html`<label class="menu-field">
          <span>${t("Nom du dossier")}</span>
          <input type="text" id="modal-name" maxlength="60"
                 value="${folderById(state, modal.id)?.name ?? ""}" />
        </label>`,
      };
  }
}

/**
 * La fenêtre elle-même.
 *
 * Elle remplace le `window.prompt` de la création de deck : une invite native
 * n'a ni le style de l'application, ni la place d'un second champ — et sur un
 * téléphone, elle s'ouvre en haut de l'écran, loin du pouce.
 */
export function modalHtml(state: DeckState): SafeHtml {
  if (!state.modal) return html``;
  const { titre, corps, valider } = modalBody(state);

  return html`<div class="deck-modal-backdrop" id="modal-backdrop"></div>
  <div class="deck-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <div class="deck-modal-head">
      <h2 id="modal-title">${titre}</h2>
      <button type="button" class="icon-btn" id="modal-close" aria-label="${t("Fermer")}">✕</button>
    </div>
    <div class="deck-modal-body">${corps}</div>
    <div class="deck-modal-foot">
      <button type="button" class="btn" id="modal-cancel">${t("Annuler")}</button>
      <button type="button" class="btn btn-primary" id="modal-ok">${valider}</button>
    </div>
  </div>`;
}
