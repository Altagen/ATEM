/**
 * L'état de l'atelier de decks.
 *
 * Comme pour les scanlistes : un seul objet, muté sur place, **jamais
 * remplacé**. L'écran en garde une référence ; la réaffecter ferait écrire ses
 * gestes dans un objet orphelin, et plus aucun bouton ne répondrait. Le défaut
 * a coûté une heure sur l'écran précédent.
 */
import type { DeckZone } from "@atem/shared";

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
  card: {
    passcode: number;
    name: string;
    type: string | null;
    frameType: string | null;
    attribute: string | null;
    banlistTcg: string | null;
    imageUrl: string | null;
    imageUrlSmall: string | null;
  } | null;
};

export type DeckCardEntry = {
  passcode: number;
  name: string;
  type: string | null;
  frameType: string | null;
  banlistTcg: string | null;
  imageUrlSmall: string | null;
  main: number;
  extra: number;
  side: number;
  owned: number;
  missing: number;
};

export type DeckSummary = {
  id: string;
  name: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  counts: Record<DeckZone, number>;
  missing: number;
};

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
  /** La nature filtrée : tout, monstre, magie, piège, extra, favoris. */
  kind: "" | "monster" | "spell" | "trap" | "extra" | "fav";
  /** Les attributs retenus. Vide = tous. */
  attributes: string[];
  /** Liste ou galerie, pour le panneau de collection. */
  collView: "list" | "gallery";
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
  kind: "",
  attributes: [],
  collView: "list",
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
