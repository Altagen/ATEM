/**
 * The router.
 *
 * A table of routes, not a cascade of `if`s. ATEM-old dispatched in a 250-line
 * `if/else`: readable at ten screens, not at all beyond.
 */
/**
 * A screen.
 *
 * The third argument lives **as long as the screen does**: it is aborted as
 * soon as we navigate elsewhere. Everything a screen sets outside its `root` —
 * a listener on `document`, a timer, a request to cancel — must hang on it,
 * otherwise it survives the screen that set it.
 *
 * The defect this fixes was seen: the deck screen set `Escape` on `document` at
 * every mount. After two navigations, three listeners answered; the oldest
 * reset the state and repainted a detached `root`, so the others had nothing
 * left to do — and the card sheet no longer closed. The root node is replaced
 * on every render, but `document` stays.
 */
export type Screen = (
  root: HTMLElement,
  params: URLSearchParams,
  signal: AbortSignal,
) => void | Promise<void>;

/**
 * What one needs to know about a screen to offer it in the navigation.
 *
 * A destination exists **only** if its route exists: both are declared
 * together, in the same place. That is what makes a tab leading nowhere
 * impossible — the classic flaw of a navigation bar written apart, where the
 * entry is added before the screen and forgotten after it goes.
 */
export type Destination = {
  label: string;
  /** An emoji, the only thing the bottom bar shows above the label. */
  icon: string;
  /** `main`: the main bar. `account`: the account sheet, on mobile. */
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
/** Aborted at the next render: this is the current screen's lifetime. */
let screenLife = new AbortController();
let sessionCheck: () => boolean = () => true;
const afterRender: (() => void)[] = [];

/**
 * To run after every route render.
 *
 * It is the right signal for anything that depends on the route **and** the
 * session — the navigation bar, for instance. Hooking onto clicks does not
 * work: the click precedes the server's answer, so after signing in the bar
 * still displayed “Sign in” until the next click.
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

/** A group's destinations, in the order they were declared. */
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
 * Replaces the root node instead of emptying it.
 *
 * ATEM-old lived the bug this fixes: a screen left behind, whose request came
 * back late, kept writing into the next screen's DOM. By replacing the node,
 * the old screen writes into an element detached from the page — harmless, and
 * with nothing to cancel.
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

  // The previous screen loses its listeners before the next one sets its own:
  // without that, they pile up on every navigation.
  screenLife.abort();
  screenLife = new AbortController();
  const signal = screenLife.signal;

  if (!match) {
    if (fallback) await fallback(root, url.searchParams, signal);
    for (const hook of afterRender) hook();
    return;
  }
  if (match.requiresSession && !sessionCheck()) {
    navigate(`/login?next=${encodeURIComponent(url.pathname + url.search)}`, {
      replace: true,
    });
    return;
  }
  for (const hook of afterRender) hook();
  // What the router does not replace — a modal attached to `document.body` —
  // must be able to close itself.
  document.dispatchEvent(new CustomEvent("atem:navigated"));
  await match.screen(root, url.searchParams, signal);
}

export function startRouter(): void {
  window.addEventListener("popstate", () => void render());
  document.addEventListener("click", (event) => {
    const link = (event.target as HTMLElement | null)?.closest<HTMLAnchorElement>("a[href^='/']");
    // We let through what the user asked for explicitly: new tab, download,
    // another target.
    if (!link || link.target || link.hasAttribute("download")) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    navigate(link.getAttribute("href")!);
  });
  void render();
}
