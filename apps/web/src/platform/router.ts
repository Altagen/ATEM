/**
 * Le routeur.
 *
 * Une table de routes, pas une cascade de `if`. ATEM-old dispatchait dans un
 * `if/else` de 250 lignes : lisible à dix écrans, plus du tout au-delà.
 */
/**
 * Un écran.
 *
 * Le troisième argument vit **le temps de l'écran** : il est rompu dès qu'on
 * navigue ailleurs. Tout ce qu'un écran pose en dehors de son `root` — un
 * écouteur sur `document`, un minuteur, une requête à annuler — doit s'y
 * accrocher, sinon il survit à l'écran qui l'a posé.
 *
 * Le défaut que ça corrige a été vu : l'écran des decks posait `Échap` sur
 * `document` à chaque montage. Après deux navigations, trois écouteurs
 * répondaient ; le plus ancien remettait l'état à zéro et repeignait un `root`
 * détaché, si bien que les suivants n'avaient plus rien à faire — et la fiche
 * de carte ne se fermait plus. Le nœud racine est remplacé à chaque rendu, mais
 * `document`, lui, reste.
 */
export type Screen = (
  root: HTMLElement,
  params: URLSearchParams,
  signal: AbortSignal,
) => void | Promise<void>;

/**
 * Ce qu'il faut savoir d'un écran pour le proposer dans la navigation.
 *
 * Une destination n'existe **que** si sa route existe : les deux sont déclarées
 * ensemble, au même endroit. C'est ce qui rend impossible un onglet qui mène
 * nulle part — le défaut classique d'une barre de navigation écrite à part, où
 * l'on ajoute l'entrée avant l'écran et où l'on oublie de la retirer après.
 */
export type Destination = {
  label: string;
  /** Une émoticône, seule chose que la barre du bas affiche au-dessus du libellé. */
  icon: string;
  /** `main` : la barre principale. `account` : la feuille de compte, sur mobile. */
  group: "main" | "account";
};

type Route = {
  path: string;
  screen: Screen;
  requiresSession?: boolean;
  nav?: Destination;
};

const routes: Route[] = [];
let fallback: Screen | null = null;
/** Rompu au rendu suivant : c'est la durée de vie de l'écran courant. */
let vieDeLEcran = new AbortController();
let sessionCheck: () => boolean = () => true;
const afterRender: (() => void)[] = [];

/**
 * À exécuter après chaque rendu de route.
 *
 * C'est le bon signal pour tout ce qui dépend de la route **et** de la session
 * — la barre de navigation, par exemple. Se brancher sur les clics ne marche
 * pas : le clic précède la réponse du serveur, si bien qu'après une connexion
 * la barre affichait encore « Connexion » jusqu'au clic suivant.
 */
export function onAfterRender(hook: () => void): void {
  afterRender.push(hook);
}

export function register(
  path: string,
  screen: Screen,
  options: { requiresSession?: boolean; nav?: Destination } = {},
) {
  routes.push({
    path,
    screen,
    requiresSession: options.requiresSession ?? false,
    nav: options.nav,
  });
}

/** Les destinations d'un groupe, dans l'ordre où elles ont été déclarées. */
export function destinations(group: Destination["group"]): { path: string; nav: Destination }[] {
  return routes
    .filter((route): route is Route & { nav: Destination } => route.nav?.group === group)
    .map((route) => ({ path: route.path, nav: route.nav }));
}

export function registerFallback(screen: Screen) {
  fallback = screen;
}

export function guardWith(check: () => boolean) {
  sessionCheck = check;
}

export function navigate(path: string, options: { replace?: boolean } = {}): void {
  if (options.replace) history.replaceState({}, "", path);
  else history.pushState({}, "", path);
  void render();
}

/**
 * Remplace le nœud racine au lieu de le vider.
 *
 * ATEM-old a vécu le bug que ça corrige : un écran quitté dont une requête
 * revenait en retard continuait d'écrire dans le DOM de l'écran suivant. En
 * remplaçant le nœud, l'ancien écran écrit dans un élément détaché de la page —
 * inoffensif, et sans avoir à annuler quoi que ce soit.
 */
function freshRoot(): HTMLElement {
  const previous = document.querySelector("#app");
  const next = document.createElement("main");
  next.id = "app";
  previous?.replaceWith(next);
  return next;
}

export async function render(): Promise<void> {
  const url = new URL(window.location.href);
  const match = routes.find((route) => route.path === url.pathname);
  const root = freshRoot();

  // L'écran précédent perd ses écouteurs avant que le suivant ne pose les
  // siens : sans ça, ils s'additionnent à chaque navigation.
  vieDeLEcran.abort();
  vieDeLEcran = new AbortController();
  const signal = vieDeLEcran.signal;

  if (!match) {
    if (fallback) await fallback(root, url.searchParams, signal);
    for (const hook of afterRender) hook();
    return;
  }
  if (match.requiresSession && !sessionCheck()) {
    navigate(`/connexion?suite=${encodeURIComponent(url.pathname + url.search)}`, {
      replace: true,
    });
    return;
  }
  for (const hook of afterRender) hook();
  // Ce que le routeur ne remplace pas — une modale posée sur `document.body` —
  // doit pouvoir se refermer de lui-même.
  document.dispatchEvent(new CustomEvent("atem:navigated"));
  await match.screen(root, url.searchParams, signal);
}

export function startRouter(): void {
  window.addEventListener("popstate", () => void render());
  document.addEventListener("click", (event) => {
    const link = (event.target as HTMLElement | null)?.closest<HTMLAnchorElement>("a[href^='/']");
    // On laisse passer ce que l'utilisateur a demandé explicitement : nouvel
    // onglet, téléchargement, autre cible.
    if (!link || link.target || link.hasAttribute("download")) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    navigate(link.getAttribute("href")!);
  });
  void render();
}
