/**
 * L'état de l'atelier de decks.
 *
 * Comme pour les scanlistes : un seul objet, muté sur place, **jamais
 * remplacé**. L'écran en garde une référence ; la réaffecter ferait écrire ses
 * gestes dans un objet orphelin, et plus aucun bouton ne répondrait. Le défaut
 * a coûté une heure sur l'écran précédent.
 */
import type { DeckZone } from "@atem/shared";

/** Une carte de la collection, **agrégée par carte** et non par impression. */
export type OwnedCard = {
  passcode: number;
  name: string;
  imageUrlSmall: string | null;
  type: string | null;
  frameType: string | null;
  banlistTcg: string | null;
  owned: number;
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
  /** La collection, pour y puiser. */
  collection: OwnedCard[];
  query: string;
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
  query: "",
  panel: "collection",
  error: "",
};

export const deckState = (): DeckState => state;

export function resetView(): void {
  state.loading = true;
  state.decks = [];
  state.opened = null;
  state.collection = [];
  state.error = "";
}

/** Combien d'exemplaires de cette carte le deck ouvert porte-t-il, en tout ? */
export function inDeck(passcode: number): number {
  const entry = state.opened?.cards.find((card) => card.passcode === passcode);
  return entry ? entry.main + entry.extra + entry.side : 0;
}

/**
 * Agrège la collection **par carte**.
 *
 * L'API rend des impressions : trois Dragons Blancs en trois codes d'extension
 * font trois lignes. Un deck compte des cartes — c'est la règle posée par Ange,
 * et celle qui gouverne le plafond des trois exemplaires. On additionne donc
 * avant d'afficher.
 */
export function aggregateByCard(
  items: { card: { passcode: number; name: string; imageUrlSmall: string | null;
    type: string | null; frameType: string | null } | null; quantity: number }[],
  banlistOf: (passcode: number) => string | null,
): OwnedCard[] {
  const parCarte = new Map<number, OwnedCard>();
  for (const item of items) {
    if (!item.card) continue;
    const existante = parCarte.get(item.card.passcode);
    if (existante) {
      existante.owned += item.quantity;
      continue;
    }
    parCarte.set(item.card.passcode, {
      passcode: item.card.passcode,
      name: item.card.name,
      imageUrlSmall: item.card.imageUrlSmall,
      type: item.card.type,
      frameType: item.card.frameType,
      banlistTcg: banlistOf(item.card.passcode),
      owned: item.quantity,
    });
  }
  return [...parCarte.values()].sort((a, b) => a.name.localeCompare(b.name, "fr"));
}
