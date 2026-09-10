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
  /** Le type d'invocation : `normal`, `effect`, `fusion`, `synchro`, `xyz`, `link`… */
  frameTypes: string[];
  /** Les types de monstre — Dragon, Guerrier. */
  races: string[];
  /** Les propriétés Magie et Piège — Continue, Équipement. Même champ d'API. */
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

  /** Préférences d'affichage, retenues d'une visite à l'autre. */
  view: "list" | "gallery";
  cols: string;
  /** `comfort` ou `compact` — la densité de la liste, posée sur `<body>`. */
  density: string;
  /** Regrouper les monstres par type plutôt que de tout mêler. */
  groupByMonster: boolean;
  pinned: boolean;
};

const PREFS_KEY = "atem.collection.prefs";

type Prefs = Pick<
  ViewState,
  "view" | "cols" | "density" | "groupByMonster" | "pinned" | "sort" | "sortDir"
>;

/**
 * Les valeurs par défaut d'ATEM-old, reprises telles quelles.
 *
 * J'en avais choisi quatre autres sans le dire : vue galerie, tri par ajout
 * récent, ordre décroissant, et regroupement par type activé. Une collection
 * s'ouvrait donc en tuiles, dans l'ordre inverse de l'ajout, découpée par
 * famille de monstre — trois écarts qui rendaient l'écran méconnaissable.
 *
 * Le tri par nom croissant est le bon réflexe : c'est ainsi qu'on cherche une
 * carte dans une liste qu'on ne connaît pas par cœur.
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
 * Les préférences d'affichage vivent dans le navigateur.
 *
 * `localStorage` peut lever — navigation privée, stockage bloqué — et une
 * préférence d'affichage ne vaut pas de faire tomber l'écran. On retombe
 * silencieusement sur les valeurs par défaut.
 */
export function readPrefs(): Prefs {
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
    // Sans stockage, les préférences ne survivent pas au rechargement. Rien de
    // plus : l'écran fonctionne à l'identique.
  }
}

export function createState(): ViewState {
  return {
    loading: true,
    items: [], total: 0, totalCopies: 0, pending: 0,
    query: "", kind: "", attributes: [], races: [], frameTypes: [], properties: [],
    levels: [], ranks: [], links: [],
    rarity: "", language: "", favoritesOnly: false, unresolvedOnly: false,
    ...readPrefs(),
  };
}

/**
 * Construit la requête envoyée au serveur.
 *
 * La catégorie « à identifier » n'est pas un type de carte : c'est l'absence de
 * carte. Elle passe donc par `unresolved`, pas par un filtre de type.
 */
export function buildQuery(state: ViewState, offset: number, limit: number): string {
  const params = new URLSearchParams();
  if (state.query.trim()) params.set("q", state.query.trim());

  // La catégorie part au serveur. La filtrer au retour, comme on le faisait,
  // retirait des lignes que le serveur avait comptées : la grille se vidait
  // pendant que le total en annonçait des centaines, et la suite était
  // inatteignable puisque la pagination portait sur le compte non filtré.
  if (state.kind === "unresolved") params.set("unresolved", "1");
  else if (state.kind) params.set("kind", state.kind);

  for (const value of state.attributes) params.append("attribute", value);
  // Les types de monstre et les propriétés Magie/Piège partagent le champ
  // `race` côté API : on les sépare à l'affichage, pas à l'envoi.
  for (const value of state.races) params.append("race", value);
  for (const value of state.properties) params.append("race", value);
  for (const value of state.frameTypes) params.append("frameType", value);
  if (state.rarity) params.set("rarity", state.rarity);
  if (state.language) params.set("language", state.language);
  if (state.favoritesOnly) params.set("favorites", "1");
  if (state.unresolvedOnly) params.set("unresolved", "1");

  // Niveau, rang et Lien sont trois listes exactes : un Xyz de rang 4 n'est pas
  // un monstre de niveau 4, et le serveur les distingue.
  for (const value of state.levels) params.append("level", value);
  for (const value of state.ranks) params.append("rank", value);
  for (const value of state.links) params.append("link", value);

  params.set("sort", state.sort);
  params.set("sortDir", state.sortDir);
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  return params.toString();
}
