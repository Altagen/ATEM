import type { CardDetail } from "../../platform/api.js";

export type CollectionItem = {
  id: number;
  setCode: string;
  quantity: number;
  isFavorite: boolean;
  notes: string | null;
  print: {
    id: number;
    setCode: string;
    setName: string | null;
    rarity: string;
    language: string;
    resolveStatus: string;
  };
  card: CardDetail | null;
};

export type Facets = {
  types: string[];
  /** The summon type: `normal`, `effect`, `fusion`, `synchro`, `xyz`, `link`… */
  frameTypes: string[];
  /** The monster types — Dragon, Warrior. */
  races: string[];
  /** Spell and Trap properties — Continuous, Equip. Same API field. */
  properties: string[];
  attributes: string[];
  rarities: string[];
  languages: string[];
};

export const EMPTY_FACETS: Facets = {
  types: [], frameTypes: [], races: [], properties: [],
  attributes: [], rarities: [], languages: [],
};

export type ViewState = {
  /**
   * Whose collection this is, when it is not the viewer's — read-only then:
   * nothing that writes is drawn (ADR-009, M4). `null` is one's own.
   */
  owner: { id: string; name: string } | null;
  loading: boolean;
  items: CollectionItem[];
  total: number;
  totalCopies: number;
  pending: number;

  query: string;
  kind: string;
  attributes: string[];
  races: string[];
  frameTypes: string[];
  properties: string[];
  levels: string[];
  ranks: string[];
  links: string[];
  rarity: string;
  language: string;
  favoritesOnly: boolean;
  unresolvedOnly: boolean;
  sort: "recent" | "name" | "quantity" | "setCode";
  sortDir: "asc" | "desc";

  /** Display preferences, remembered from one visit to the next. */
  view: "list" | "gallery";
  cols: string;
  /** `comfort` or `compact` — the list's density, set on `<body>`. */
  density: string;
  /** Group monsters by type rather than mixing everything. */
  groupByMonster: boolean;
  pinned: boolean;
};

const PREFS_KEY = "atem.collection.prefs";

type Prefs = Pick<
  ViewState,
  "view" | "cols" | "density" | "groupByMonster" | "pinned" | "sort" | "sortDir"
>;

/**
 * The earlier prototype's default values, taken as they are.
 *
 * I had picked four others without saying so: gallery view, sort by recent
 * addition, descending order, and grouping by type enabled. A collection
 * therefore opened as tiles, in reverse order of addition, cut up by monster
 * family — three departures that made the screen unrecognisable.
 *
 * Sorting by name ascending is the right reflex: that is how one looks for a
 * card in a list one does not know by heart.
 */
const DEFAULT_PREFS: Prefs = {
  view: "list",
  cols: "auto",
  density: "comfort",
  groupByMonster: false,
  pinned: true,
  sort: "name",
  sortDir: "asc",
};

/**
 * Display preferences live in the browser.
 *
 * `localStorage` can throw — private browsing, blocked storage — and a display
 * preference is not worth bringing the screen down. We fall back silently to
 * the default values.
 */
function readPrefs(): Prefs {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function writePrefs(state: ViewState): void {
  try {
    const prefs: Prefs = {
      view: state.view,
      cols: state.cols,
      density: state.density,
      groupByMonster: state.groupByMonster,
      pinned: state.pinned,
      sort: state.sort,
      sortDir: state.sortDir,
    };
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Without storage, preferences do not survive a reload. Nothing more: the
    // screen works identically.
  }
}

export function createState(): ViewState {
  return {
    owner: null,
    loading: true,
    items: [], total: 0, totalCopies: 0, pending: 0,
    query: "", kind: "", attributes: [], races: [], frameTypes: [], properties: [],
    levels: [], ranks: [], links: [],
    rarity: "", language: "", favoritesOnly: false, unresolvedOnly: false,
    ...readPrefs(),
  };
}

/**
 * Builds the query sent to the server.
 *
 * The “to identify” category is not a card type: it is the absence of a card.
 * So it goes through `unresolved`, not through a type filter.
 */
export function buildQuery(state: ViewState, offset: number, limit: number): string {
  const params = new URLSearchParams();
  if (state.query.trim()) params.set("q", state.query.trim());

  // The category goes to the server. Filtering it on the way back, as we used
  // to, removed rows the server had counted: the grid emptied while the total
  // announced hundreds, and the rest was unreachable since pagination was based
  // on the unfiltered count.
  if (state.kind === "unresolved") params.set("unresolved", "1");
  else if (state.kind) params.set("kind", state.kind);

  for (const value of state.attributes) params.append("attribute", value);
  // Monster types and Spell/Trap properties share the `race` field on the API
  // side: we split them for display, not when sending.
  for (const value of state.races) params.append("race", value);
  for (const value of state.properties) params.append("race", value);
  for (const value of state.frameTypes) params.append("frameType", value);
  if (state.rarity) params.set("rarity", state.rarity);
  if (state.language) params.set("language", state.language);
  if (state.favoritesOnly) params.set("favorites", "1");
  if (state.unresolvedOnly) params.set("unresolved", "1");

  // Level, rank and Link are three exact lists: a rank-4 Xyz is not a level-4
  // monster, and the server tells them apart.
  for (const value of state.levels) params.append("level", value);
  for (const value of state.ranks) params.append("rank", value);
  for (const value of state.links) params.append("link", value);

  params.set("sort", state.sort);
  params.set("sortDir", state.sortDir);
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  return params.toString();
}
