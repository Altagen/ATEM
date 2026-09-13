/**
 * L'état de l'atelier de decks.
 *
 * Comme pour les scanlistes : un seul objet, muté sur place, **jamais
 * remplacé**. L'écran en garde une référence ; la réaffecter ferait écrire ses
 * gestes dans un objet orphelin, et plus aucun bouton ne répondrait. Le défaut
 * a coûté une heure sur l'écran précédent.
 */
import type { DeckZone } from "@atem/shared";
import type { CardDetail } from "../../platform/api.js";

/**
 * Une ligne de la collection, telle que l'API la rend — **par impression**.
 *
 * C'est ce qu'ATEM-old affichait aussi : on voit le code d'extension qu'on
 * possède. Le **compte**, lui, est par carte — trois Dragons Blancs en trois
 * codes font trois Dragons Blancs. Les deux cohabitent sans se contredire :
 * la ligne montre une impression, le plafond regarde la carte.
 */
export type CollectionRow = {
  id: number;
  setCode: string;
  quantity: number;
  isFavorite: boolean;
  /**
   * La fiche complète, telle que l'API la rend.
   *
   * Un sous-ensemble taillé sur les besoins de l'atelier a d'abord vécu ici —
   * et il a fallu l'élargir dès que la fiche en grand est arrivée. `CardDetail`
   * est le contrat du serveur ; le redéclarer en plus petit ne fait qu'ajouter
   * un endroit où il peut mentir.
   */
  card: CardDetail | null;
};

export type DeckCardEntry = {
  passcode: number;
  name: string;
  banlistTcg: string | null;
  imageUrlSmall: string | null;
  main: number;
  extra: number;
  side: number;
  owned: number;
  missing: number;
};

/**
 * Un deck, tel que l'API le rend.
 *
 * Les horodatages n'y sont pas : le serveur les envoie, l'écran ne les montre
 * nulle part, et déclarer ce qu'on n'affiche pas invite à l'afficher — la même
 * règle que pour les dossiers.
 */
export type DeckSummary = {
  id: string;
  name: string;
  counts: Record<DeckZone, number>;
  missing: number;
  /** L'illustration du deck — celle de la carte la plus jouée, choisie par le serveur. */
  coverImage: string | null;
  /** Le dossier qui le range, ou `null` à la racine. */
  folderId: string | null;
};

/**
 * Un dossier, tel que l'API le rend.
 *
 * `path` et `depth` viennent du serveur : les recalculer ici serait une seconde
 * réponse à la même question. Ses horodatages ne sont pas déclarés — l'écran ne
 * les montre nulle part, et déclarer ce qu'on n'affiche pas invite à l'afficher.
 */
export type DeckFolder = {
  id: string;
  parentId: string | null;
  name: string;
  path: string[];
  depth: number;
};

/**
 * La fenêtre ouverte par-dessus l'écran, s'il y en a une.
 *
 * Une seule à la fois, et son genre dit ce qu'elle demande. Le nom saisi n'est
 * pas ici : il vit dans le champ, comme partout ailleurs dans l'application, et
 * la repeinture le préserve.
 */
export type DeckModal =
  | { kind: "new-deck" }
  | { kind: "new-folder" }
  | { kind: "rename-folder"; id: string };

/**
 * Ce qu'on est en train de déplacer, et rien d'autre.
 *
 * **Le déplacement n'est pas une fenêtre, c'est un mode.** Un menu déroulant
 * d'arborescence grandit avec le nombre de dossiers et oblige à se représenter
 * l'arbre au lieu de le regarder ; ici l'on navigue normalement, et « Déplacer
 * ici » dépose à l'endroit qu'on a sous les yeux. C'est le geste de Google
 * Drive, proposé par Ange, et c'est le seul qui garde la navigation tactile
 * comme unique façon de désigner un endroit.
 */
export type DeckMoving = { kind: "deck" | "folder"; id: string };

export type DeckDetail = DeckSummary & { cards: DeckCardEntry[] };

export type DeckState = {
  loading: boolean;
  decks: DeckSummary[];
  /** Le deck ouvert dans l'atelier, quand l'URL en désigne un. */
  opened: DeckDetail | null;
  /**
   * La zone qui reçoit les « +1 » venus de la collection.
   *
   * Sauf pour un monstre d'Extra Deck, qui y va toujours : c'est la règle du
   * jeu, et le serveur la refuserait de toute façon. L'onglet dit où vont les
   * autres.
   */
  zone: DeckZone;
  /** La collection, pour y puiser — une ligne par impression. */
  collection: CollectionRow[];
  /** Combien d'exemplaires par **carte**, toutes impressions confondues. */
  owned: Map<number, number>;
  query: string;
  /**
   * La carte ouverte en grand, par son passcode.
   *
   * On la garde par identité plutôt que par valeur : la fiche se redessine
   * après chaque « +1 », et une copie figée afficherait un compte périmé.
   */
  openedCard: number | null;
  /** La nature filtrée : tout, monstre, magie, piège, extra, favoris. */
  kind: "" | "monster" | "spell" | "trap" | "extra" | "fav";
  /** Les attributs retenus. Vide = tous. */
  attributes: string[];
  /** Liste ou galerie, pour le panneau de collection. */
  collView: "list" | "gallery";
  /** Les dossiers de la personne, à plat — l'arbre se lit dans `parentId`. */
  folders: DeckFolder[];
  /**
   * Le dossier que l'on regarde, ou la racine.
   *
   * Un seul étage à la fois, comme un explorateur de fichiers. ATEM-old avait
   * commencé par déplier tout l'arbre d'un coup : à trois niveaux, on lisait
   * une carte de métro pour trouver un deck. Il a fini par revenir à l'étage
   * courant, et c'est de là qu'on part.
   */
  folderId: string | null;
  /** Le menu « ⋯ » ouvert : l'identifiant d'un deck ou d'un dossier. */
  menu: string | null;
  /** La fenêtre par-dessus l'écran, s'il y en a une. */
  modal: DeckModal | null;
  /** Le déplacement en cours, s'il y en a un. */
  moving: DeckMoving | null;
  /**
   * Liste ou galerie, pour la page des decks.
   *
   * La galerie par défaut : une planche d'illustrations se reconnaît d'un coup
   * d'œil là où une liste de noms se lit. La liste reste à un clic, et sert dès
   * qu'on en a beaucoup.
   */
  listView: "list" | "gallery";
  /**
   * L'instant de la dernière écriture, ou `null`.
   *
   * L'atelier n'a aucun bouton d'enregistrement : les cartes partent à chaque
   * « ± », le nom quand la frappe se calme. Rien ne le disait, et un bouton
   * « Enregistrer » juste à côté laissait croire le contraire. ATEM-old
   * affichait « non enregistré » parce qu'il travaillait sur un brouillon ;
   * nous affichons l'inverse, brièvement, parce qu'il n'y en a pas.
   */
  savedAt: number | null;
  /**
   * Le panneau visible, sur écran étroit.
   *
   * Sur un téléphone, empiler la collection et les zones oblige à traverser
   * quarante cartes pour atteindre son deck. ATEM-old avait tranché de la même
   * façon : au-delà de 900 px les deux tiennent côte à côte, en dessous on
   * bascule. La valeur ne sert à rien sur un écran large, et le CSS l'ignore.
   */
  panel: "collection" | "zones";
  error: string;
};

const state: DeckState = {
  loading: true,
  decks: [],
  opened: null,
  zone: "main",
  collection: [],
  owned: new Map(),
  query: "",
  openedCard: null,
  kind: "",
  attributes: [],
  collView: "list",
  folders: [],
  folderId: null,
  menu: null,
  modal: null,
  moving: null,
  listView: "gallery",
  savedAt: null,
  panel: "collection",
  error: "",
};

export const deckState = (): DeckState => state;

export function resetView(): void {
  state.loading = true;
  state.decks = [];
  state.opened = null;
  state.collection = [];
  state.owned = new Map();
  state.openedCard = null;
  state.folders = [];
  state.folderId = null;
  state.menu = null;
  state.modal = null;
  state.moving = null;
  state.savedAt = null;
  state.error = "";
}

/** Combien d'exemplaires de cette carte le deck ouvert porte-t-il, en tout ? */
export function inDeck(passcode: number): number {
  const entry = state.opened?.cards.find((card) => card.passcode === passcode);
  return entry ? entry.main + entry.extra + entry.side : 0;
}

/**
 * Compte les exemplaires **par carte**, toutes impressions confondues.
 *
 * L'API rend des impressions : trois Dragons Blancs en trois codes d'extension
 * font trois lignes. Un deck compte des cartes — c'est la règle posée par Ange,
 * et celle qui gouverne le plafond des trois exemplaires. On additionne donc
 * sans perdre les lignes, qui gardent le code qu'on possède.
 */
export function countByCard(rows: CollectionRow[]): Map<number, number> {
  const total = new Map<number, number>();
  for (const row of rows) {
    if (!row.card) continue;
    total.set(row.card.passcode, (total.get(row.card.passcode) ?? 0) + row.quantity);
  }
  return total;
}
