/**
 * The deck workshop's state.
 *
 * As for the scanlists: a single object, mutated in place, **never replaced**.
 * The screen keeps a reference to it; reassigning it would write its gestures
 * into an orphaned object, and no button would answer any more. That defect
 * cost an hour on the previous screen.
 */
import type { DeckZone } from "@atem/shared";
import type { CardDetail } from "../../platform/api.js";

/**
 * A collection row, as the API returns it — **per printing**.
 *
 * That is what ATEM-old displayed too: you see the set code you own. The
 * **count**, though, is per card — three Blue-Eyes across three codes make
 * three Blue-Eyes. The two live together without contradicting each other: the
 * row shows a printing, the ceiling looks at the card.
 */
export type CollectionRow = {
  id: number;
  setCode: string;
  quantity: number;
  isFavorite: boolean;
  /**
   * The full card record, as the API returns it.
   *
   * A subset cut to the workshop's needs lived here first — and it had to be
   * widened as soon as the full-size sheet arrived. `CardDetail` is the
   * server's contract; redeclaring it smaller only adds one more place where it
   * can lie.
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
 * A deck, as the API returns it.
 *
 * The timestamps are not here: the server sends them, the screen shows them
 * nowhere, and declaring what you do not display invites displaying it — the
 * same rule as for folders.
 */
export type DeckSummary = {
  id: string;
  name: string;
  counts: Record<DeckZone, number>;
  missing: number;
  /** The folder it is filed in, or `null` at the root. */
  folderId: string | null;
  /**
   * The Main Deck size this deck is aimed at — what “finished” means for it.
   * The server decides the default (40), so the screen never invents one.
   */
  targetMain: number;
};

/**
 * A folder, as the API returns it.
 *
 * `path` and `depth` come from the server: recomputing them here would be a
 * second answer to the same question. Its timestamps are not declared — the
 * screen shows them nowhere, and declaring what you do not display invites
 * displaying it.
 */
export type DeckFolder = {
  id: string;
  parentId: string | null;
  name: string;
  path: string[];
  depth: number;
};

/**
 * The window opened over the screen, if there is one.
 *
 * One at a time, and its kind says what it asks for. The typed name is not
 * here: it lives in the field, as everywhere else in the application, and the
 * repaint preserves it.
 */
export type DeckModal =
  | { kind: "new-deck" }
  | { kind: "new-folder" }
  | { kind: "rename-folder"; id: string }
  /**
   * The deck's own settings — its target size, today.
   *
   * It reuses the same window as the rest rather than bringing its own: one
   * backdrop, one Escape, one Cancel that undoes nothing because nothing was
   * written yet.
   */
  | { kind: "deck-options"; id: string };

/**
 * What is being moved, and nothing else.
 *
 * **Moving is not a window, it is a mode.** A tree drop-down grows with the
 * number of folders and forces you to picture the tree instead of looking at
 * it; here you navigate normally, and “Move here” drops at the place you have
 * in front of you. That is Google Drive's gesture, proposed by Ange, and it is
 * the only one that keeps touch navigation as the single way to designate a
 * place.
 */
export type DeckMoving = { kind: "deck" | "folder"; id: string };

export type DeckDetail = DeckSummary & { cards: DeckCardEntry[] };

export type DeckState = {
  loading: boolean;
  decks: DeckSummary[];
  /** The deck open in the workshop, when the URL designates one. */
  opened: DeckDetail | null;
  /**
   * The zone that receives the “+1” coming from the collection.
   *
   * Except for an Extra Deck monster, which always goes there: that is the
   * game's rule, and the server would refuse otherwise anyway. The tab says
   * where the others go.
   */
  zone: DeckZone;
  /** The collection, to draw from — one row per printing. */
  collection: CollectionRow[];
  /** How many copies per **card**, all printings taken together. */
  owned: Map<number, number>;
  query: string;
  /**
   * The card opened full size, by its passcode.
   *
   * We keep it by identity rather than by value: the sheet is redrawn after
   * every “+1”, and a frozen copy would display a stale count.
   */
  openedCard: number | null;
  /** The filtered nature: all, monster, spell, trap, extra, favourites. */
  kind: "" | "monster" | "spell" | "trap" | "extra" | "fav";
  /** The attributes kept. Empty = all of them. */
  attributes: string[];
  /** List or gallery, for the collection panel. */
  collView: "list" | "gallery";
  /** The person's folders, flat — the tree is read from `parentId`. */
  folders: DeckFolder[];
  /**
   * The folder being looked at, or the root.
   *
   * One level at a time, like a file explorer. ATEM-old had started by
   * unfolding the whole tree at once: at three levels, you were reading a metro
   * map to find a deck. It ended up going back to the current level, and that
   * is where we start from.
   */
  folderId: string | null;
  /**
   * The workshop rather than the sheet.
   *
   * **Opening a deck shows it, it does not open it for writing.** The sheet has
   * no control that writes a card; the pencil leads to the workshop, and the
   * address says so (`?workshop=1`). That is ATEM-old's shape, and it is what
   * will make showing another player's deck possible without writing a second
   * screen: it will be enough not to display the pencil.
   */
  editing: boolean;
  /** The zone being looked at on the sheet — “all” on top of the three. */
  sheetZone: "all" | DeckZone;
  /** List or gallery, for the deck sheet. */
  sheetView: "list" | "gallery";
  /**
   * The card records already requested from the deck sheet.
   *
   * A deck row only carries its name, its artwork and its banlist status:
   * enough to read it, not to detail it. The rest is asked for when the card is
   * opened, once per card — and not when the deck loads, where sixty full
   * records would cross the network for nothing.
   */
  cardDetails: Map<number, CardDetail>;
  /** The open “⋯” menu: the identifier of a deck or of a folder. */
  menu: string | null;
  /** The window over the screen, if there is one. */
  modal: DeckModal | null;
  /** The move under way, if there is one. */
  moving: DeckMoving | null;
  /**
   * List or gallery, for the decks page.
   *
   * Gallery by default: a board of artworks is recognised at a glance where a
   * list of names has to be read. The list stays one click away, and serves as
   * soon as there are many.
   */
  listView: "list" | "gallery";
  /**
   * The instant of the last write, or `null`.
   *
   * The workshop has no save button: cards leave at every “±”, the name when
   * the typing settles. Nothing said so, and a “Save” button right next to it
   * suggested the opposite. ATEM-old displayed “unsaved” because it worked on a
   * draft; we display the reverse, briefly, because there is none.
   */
  savedAt: number | null;
  /**
   * The visible panel, on a narrow screen.
   *
   * On a phone, stacking the collection and the zones forces you to cross forty
   * cards to reach your deck. ATEM-old had decided the same way: past 900 px
   * the two fit side by side, below that you toggle. The value is useless on a
   * wide screen, and the CSS ignores it.
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
  editing: false,
  sheetZone: "all",
  sheetView: "list",
  cardDetails: new Map(),
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
  state.editing = false;
  state.sheetZone = "all";
  state.cardDetails = new Map();
  state.menu = null;
  state.modal = null;
  state.moving = null;
  state.savedAt = null;
  state.error = "";
}

/** How many copies of this card does the open deck carry, all zones together? */
export function inDeck(passcode: number): number {
  const entry = state.opened?.cards.find((card) => card.passcode === passcode);
  return entry ? entry.main + entry.extra + entry.side : 0;
}

/**
 * Counts copies **per card**, all printings taken together.
 *
 * The API returns printings: three Blue-Eyes across three set codes make three
 * rows. A deck counts cards — that is the rule Ange laid down, and the one that
 * governs the three-copy ceiling. So we add up without losing the rows, which
 * keep the code actually owned.
 */
export function countByCard(rows: CollectionRow[]): Map<number, number> {
  const total = new Map<number, number>();
  for (const row of rows) {
    if (!row.card) continue;
    total.set(row.card.passcode, (total.get(row.card.passcode) ?? 0) + row.quantity);
  }
  return total;
}
