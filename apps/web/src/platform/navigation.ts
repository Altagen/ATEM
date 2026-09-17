/**
 * The navigation shell.
 *
 * Three surfaces, one state:
 *
 * — the **top bar**, on wide screens;
 * — the **bottom bar**, on phones, which replaces it entirely;
 * — the **account sheet**, which the bottom bar opens.
 *
 * Choosing to replace rather than adapt comes from ATEM-old, and it holds: on
 * mobile the top bar kept only the brand, the service state and the avatar —
 * five targets in a 62 px strip, for settings nobody visits in a loop. The
 * thumb, meanwhile, is at the bottom of the screen.
 *
 * **Destinations come from the router.** No list is kept here: a screen
 * declares its route and its place in the navigation in one gesture, and an
 * entry leading nowhere becomes impossible to write.
 */
import { api, ApiError, type PublicUser } from "./api.js";
import { avatarLooks } from "./avatar.js";
import { t } from "./i18n/index.js";
import { destinations, navigate, render } from "./router.js";
import { lockScroll, unlockScroll } from "./scroll-lock.js";
import { knownUser, setUser } from "./session.js";
import { el, toast } from "./ui.js";

type ServiceState = "ok" | "unreachable" | "unknown";

let serviceState: ServiceState = "unknown";

/**
 * The service state — translated at display time, not at declaration.
 *
 * This table is evaluated at import, before the account's language is known:
 * calling `t()` here would freeze one language for the whole session.
 */
const SERVICE_LABELS: Record<ServiceState, { text: string; className: string }> = {
  ok: { text: "Online", className: "api-ok" },
  unreachable: { text: "Unreachable", className: "api-err" },
  unknown: { text: "…", className: "api-warn" },
};

/**
 * The service state, shown at all times.
 *
 * When the server stops answering, every gesture fails with a different message
 * and people go looking for the bug in the application. A pill saying
 * “unreachable” answers the question before it is asked.
 */
export async function refreshServiceState(): Promise<void> {
  try {
    await api("/health");
    serviceState = "ok";
  } catch {
    serviceState = "unreachable";
  }
  renderNavigation();
}

/**
 * The language choice.
 *
 * It lives here, in the top bar and in the account sheet, rather than in the
 * settings screen: it is changed from anywhere, in one gesture. Two buttons
 * rather than a menu: there are only two languages, and a dropdown would ask two
 * gestures for the same thing.
 */
function languageSwitch(): HTMLElement {
  const user = knownUser()!;
  const group = el("div", { class: "lang-switch", role: "group", "aria-label": t("Language") });

  for (const code of ["fr", "en"] as const) {
    const button = el("button", {
      type: "button",
      class: `lang-switch-item${user.locale === code ? " is-active" : ""}`,
      "aria-pressed": String(user.locale === code),
    }, [t(code === "fr" ? "FR" : "EN")]);

    button.addEventListener("click", () => {
      if (user.locale === code) return;
      void switchLanguage(code);
    });
    group.append(button);
  }
  return group;
}

async function switchLanguage(locale: "fr" | "en"): Promise<void> {
  try {
    const { user } = await api<{ user: PublicUser }>("/auth/me/locale", {
      method: "PATCH",
      body: { locale },
    });
    // `setUser` applies the language, then we repaint everything: the bar, and
    // the current screen, which was rendered in the other language.
    setUser(user);
    renderNavigation();
    void render();
  } catch (err) {
    toast(err instanceof ApiError ? err.message : t("Saving failed."), "error");
  }
}

/**
 * A navigation link — **and its translated label**.
 *
 * Destinations come from the router, where they are declared as plain strings.
 * They used to be displayed as written: “Collection” is identical in both
 * languages, which hid the defect until another destination arrived.
 */
function link(path: string, label: string, className: string, icon?: string): HTMLElement {
  const isActive = window.location.pathname === path;
  const node = el("a", { class: className, href: path }, []);
  if (icon) node.append(el("span", { "aria-hidden": "true" }, [icon]));
  node.append(el("span", {}, [t(label)]));
  if (isActive) {
    node.classList.add("is-active");
    node.setAttribute("aria-current", "page");
  }
  return node;
}

function appBar(signal: AbortSignal): HTMLElement {
  const user = knownUser()!;
  const nav = el("nav", { class: "app-nav" });
  for (const { path, nav: destination } of destinations("main")) {
    nav.append(link(path, destination.label, "nav-link"));
  }

  const service = SERVICE_LABELS[serviceState];

  return el("header", { class: "app-bar" }, [
    el("div", { class: "app-bar-left" }, [
      el("a", { class: "brand", href: "/" }, ["ATEM"]),
      nav,
    ]),
    el("div", { class: "app-bar-right" }, [
      languageSwitch(),
      el("span", { class: `api-pill ${service.className}` }, [t(service.text)]),
      userMenu(user, signal),
    ]),
  ]);
}

/**
 * The account, on a wide screen: your avatar opens a menu.
 *
 * ATEM-old's user menu (`header-nav.ts` and the design's `shell.js`): a round
 * avatar in the bar, and behind it who you are, then your destinations and
 * signing out. The name is in the menu's head rather than in the bar, where it
 * took the room of a button. Not carried over: the inbox bell, which has nothing
 * to deliver yet, and “Refresh”, which the browser already does.
 *
 * The entries are the account group's destinations, read from the router — the
 * same list the phone's sheet reads, so a new account screen appears in both
 * without either being edited.
 */
function userMenu(user: NonNullable<ReturnType<typeof knownUser>>, signal: AbortSignal): HTMLElement {
  const look = avatarLooks()[user.avatar];
  const identity = `${user.displayName} #${user.tag}`;
  const menu = el("div", { class: "menu", role: "menu", id: "user-menu" }, [
    el("div", { class: "app-user-menu-head" }, [
      el("span", { class: "user-avatar-badge", "aria-hidden": "true" }, [look.icon]),
      el("span", {}, [
        el("span", { class: "app-user-menu-name" }, [user.displayName]),
        el("span", { class: "muted app-user-menu-mail" }, [`#${user.tag}`]),
      ]),
    ]),
  ]);
  for (const { path, nav: destination } of destinations("account")) {
    menu.append(
      el("a", { class: "menu-item", role: "menuitem", href: path }, [
        el("span", { "aria-hidden": "true" }, [destination.icon]),
        " ",
        t(destination.label),
      ]),
    );
  }
  if (menu.childElementCount > 0) menu.append(el("div", { class: "menu-sep", role: "separator" }));

  const signOut = el("button", { type: "button", class: "menu-item menu-item-danger", role: "menuitem" }, [
    t("Sign out"),
  ]);
  signOut.addEventListener("click", () => void signOutNow());
  menu.append(signOut);

  const trigger = el("button", {
    type: "button",
    class: "app-avatar",
    id: "user-menu-button",
    "aria-haspopup": "menu",
    "aria-expanded": "false",
    "aria-controls": "user-menu",
    // The picture says nothing to a screen reader: the button says whose it is.
    "aria-label": t("Account menu — {name}", { name: identity }),
    title: identity,
  }, [look.icon]);

  // `.menu` is `display: none` until `.is-open` — the sheet's contract, which
  // ATEM-old's menus already followed. Toggling `hidden` instead opens nothing.
  const isOpen = (): boolean => menu.classList.contains("is-open");
  const setOpen = (open: boolean): void => {
    menu.classList.toggle("is-open", open);
    trigger.setAttribute("aria-expanded", String(open));
  };
  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    setOpen(!isOpen());
  });
  // Choosing an entry navigates; the menu must not stay open over the next screen.
  menu.addEventListener("click", () => setOpen(false));
  // Bound to the bar's lifetime: see `navigationListeners`.
  document.addEventListener("click", (event) => {
    if (isOpen() && !anchor.contains(event.target as Node)) setOpen(false);
  }, { signal });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isOpen()) {
      setOpen(false);
      trigger.focus();
    }
  }, { signal });

  const anchor = el("div", { class: "menu-anchor" }, [trigger, menu]);
  return anchor;
}

function bottomNav(): HTMLElement {
  const nav = el("nav", { class: "global-mobile-bottom-nav", "aria-label": t("Navigation") });
  for (const { path, nav: destination } of destinations("main")) {
    nav.append(link(path, destination.label, "global-mobile-nav-item", destination.icon));
  }

  const account = el("button", {
    type: "button",
    class: "global-mobile-nav-item",
    "aria-label": t("My account"),
    "aria-haspopup": "dialog",
  }, [
    el("span", { "aria-hidden": "true" }, ["👤"]),
    el("span", {}, [t("Account")]),
  ]);
  account.addEventListener("click", () => openAccountSheet());
  nav.append(account);

  return nav;
}

/**
 * The account sheet.
 *
 * On phones it replaces what the top bar carried on its right: the identity,
 * the service state, the secondary screens and signing out.
 */
function accountSheet(): { backdrop: HTMLElement; sheet: HTMLElement } {
  const user = knownUser()!;
  const service = SERVICE_LABELS[serviceState];

  const close = el("button", { type: "button", class: "icon-btn", "aria-label": t("Close") }, ["✕"]);
  close.addEventListener("click", closeAccountSheet);

  const list = el("nav", { class: "account-sheet-list" });
  for (const { path, nav: destination } of destinations("account")) {
    list.append(
      el("a", { class: "account-sheet-item", href: path }, [
        el("span", { "aria-hidden": "true" }, [destination.icon]),
        el("span", {}, [t(destination.label)]),
        el("span", { class: "account-sheet-chev", "aria-hidden": "true" }, ["›"]),
      ]),
    );
  }
  // With no secondary destination the list has nothing to show: we do not
  // leave an empty container that would look like loading.
  if (list.childElementCount === 0) list.remove();

  const signOut = el("button", { type: "button", class: "account-sheet-logout" }, [
    t("Sign out"),
  ]);
  signOut.addEventListener("click", () => void signOutNow());

  const sheet = el("section", {
    class: "account-sheet",
    id: "account-sheet",
    role: "dialog",
    "aria-modal": "true",
    "aria-label": t("My account"),
    hidden: "",
  }, [
    el("span", { class: "account-sheet-grip", "aria-hidden": "true" }),
    el("header", { class: "account-sheet-head" }, [
      el("span", { class: "account-sheet-brand" }, ["ATEM"]),
      el("span", { class: "account-sheet-identity" }, [
        el("strong", {}, [`${user.displayName} #${user.tag}`]),
        el("span", { class: `api-pill ${service.className}` }, [t(service.text)]),
      ]),
      close,
    ]),
    ...(list.isConnected || list.childElementCount > 0 ? [list] : []),
    el("footer", { class: "account-sheet-foot" }, [languageSwitch(), signOut]),
  ]);

  const backdrop = el("div", { class: "account-backdrop", id: "account-backdrop", hidden: "" });
  backdrop.addEventListener("click", closeAccountSheet);

  return { backdrop, sheet };
}

function openAccountSheet(): void {
  const sheet = document.querySelector<HTMLElement>("#account-sheet");
  if (!sheet || !sheet.hidden) return;

  for (const id of ["account-backdrop", "account-sheet"]) {
    const node = document.querySelector<HTMLElement>(`#${id}`);
    if (node) node.hidden = false;
  }
  lockScroll();
  document.querySelector<HTMLElement>("#account-sheet .icon-btn")?.focus();
}

export function closeAccountSheet(): void {
  const sheet = document.querySelector<HTMLElement>("#account-sheet");
  const wasOpen = sheet !== null && !sheet.hidden;

  for (const id of ["account-backdrop", "account-sheet"]) {
    const node = document.querySelector<HTMLElement>(`#${id}`);
    if (node) node.hidden = true;
  }
  if (wasOpen) unlockScroll();
}

async function signOutNow(): Promise<void> {
  try {
    await api("/auth/logout", { method: "POST" });
  } finally {
    // Even if the server did not answer, we do not let anyone believe they are
    // still signed in: the local state follows the request.
    setUser(null);
    renderNavigation();
    navigate("/login");
  }
}

/**
 * Rebuilds the navigation.
 *
 * Everything is redone rather than patched in place: the current destination,
 * the identity and the service state change together, and synchronising them by
 * hand is the kind of detail one ends up forgetting somewhere.
 */
/**
 * The listeners the current bar put on `document`, withdrawn when it is rebuilt.
 *
 * The bar is rebuilt on every screen change **and every minute**, by the
 * service-state poll. A listener added on `document` survives the removal of the
 * element that added it, so without this each rebuild would leave its pair
 * behind — about sixty an hour, each closing over a menu no longer on the page.
 */
let navigationListeners: AbortController | null = null;

export function renderNavigation(): void {
  navigationListeners?.abort();
  navigationListeners = new AbortController();

  /**
   * The sheet is closed properly before being rebuilt.
   *
   * This function is also called every minute by the service-state poll:
   * removing the sheet without closing it would leave the scroll lock in place
   * for nothing, and the page would never scroll again.
   */
  closeAccountSheet();

  for (const selector of [".app-bar", ".global-mobile-bottom-nav", "#account-sheet", "#account-backdrop"]) {
    document.querySelector(selector)?.remove();
  }

  // The authentication screens carry their own header, and have nothing to
  // navigate.
  if (!knownUser()) return;

  const { backdrop, sheet } = accountSheet();
  document.body.prepend(appBar(navigationListeners.signal));
  document.body.append(bottomNav(), backdrop, sheet);
}
