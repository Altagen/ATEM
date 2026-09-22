/**
 * The navigation shell.
 *
 * Three surfaces, one state:
 *
 * — the **top bar**, on wide screens;
 * — the **bottom bar**, on phones, which replaces it entirely;
 * — the **account sheet**, which the bottom bar opens.
 *
 * Choosing to replace rather than adapt comes from the earlier prototype, and it holds: on
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
import { destinations, navigate, render, type Audience } from "./router.js";
import { lockScroll, unlockScroll } from "./scroll-lock.js";
import { knownUser, setUser } from "./session.js";
import { el, toast } from "./ui.js";

type ServiceState = "ok" | "unreachable" | "unknown";

let serviceState: ServiceState = "unknown";
/** How many notifications are waiting, as of the last count read. */
let unread = 0;

/**
 * The service state — translated at display time, not at declaration.
 *
 * This table is evaluated at import, before the account's language is known:
 * calling `t()` here would freeze one language for the whole session.
 */
const SERVICE_LABELS: Record<ServiceState, { text: string; className: string }> = {
  // “API”, as the earlier prototype wrote it: a bare “Online” reads as the person's presence.
  ok: { text: "API online", className: "api-ok" },
  unreachable: { text: "API unreachable", className: "api-err" },
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
 * How many notifications are waiting.
 *
 * Asked for every few seconds rather than held open on a live connection: the
 * question is one integer behind a partial index, and a socket per visitor is a
 * lot of machinery for a badge. The maintainer, on 2026-09-19: “there should be
 * polling every 5 seconds so that one does not have to refresh a page”.
 *
 * **The bar is rebuilt only when the number changes.** Rebuilding it every few
 * seconds would close an open menu under the pointer, which is the defect the
 * account sheet already taught us.
 */
/**
 * Where the source is. ATEM is under the AGPL-3.0: whoever uses an instance
 * over the network can reach its source — a modified instance must point here
 * at its own.
 */
const SOURCE_URL = "https://github.com/Altagen/ATEM";

/** Whose navigation this is: the administrator's has only its console. */
function audienceOf(user: NonNullable<ReturnType<typeof knownUser>>): Audience {
  return user.role === "admin" ? "admin" : "player";
}

export async function refreshInbox(): Promise<void> {
  const user = knownUser();
  // The administrator has no inbox, and an account still to change its password
  // may not read one yet: asking would only collect refusals every five seconds.
  if (!user || user.role === "admin" || user.mustChangePassword) {
    unread = 0;
    return;
  }
  let answer: { unread: number };
  try {
    answer = await api<{ unread: number }>("/inbox/unread");
  } catch {
    // A badge is not worth a message: it stays as it was.
    return;
  }
  if (answer.unread === unread) return;
  unread = answer.unread;
  renderNavigation();
}

/**
 * The inbox, reached from the top bar.
 *
 * The earlier prototype's bell, with its count. The badge disappears at zero rather than
 * showing it: a zero is a thing to read for nothing.
 */
function inboxBell(): HTMLElement {
  const label = unread > 0
    ? t("Inbox — {n} waiting", { n: String(unread) })
    : t("Inbox");
  const bell = el("a", { class: "btn-icon app-inbox", href: "/inbox", "aria-label": label, title: label }, ["📬"]);
  if (unread > 0) {
    bell.append(el("span", { class: "app-inbox-dot" }, [unread > 9 ? "9+" : String(unread)]));
  }
  return bell;
}

/**
 * The language choice, in the top bar: The earlier prototype's pill.
 *
 * It lives in the navigation rather than in the settings screen: it is changed
 * from anywhere, in one gesture, and it is the only preference there is — a
 * settings tab holding it alone would be an empty room. The pill shows the
 * current language and switches to the other one: with two languages, one
 * button is the whole choice.
 */
function languagePill(): HTMLElement {
  const user = knownUser()!;
  const current = user.locale === "en"
    ? { flag: "🇬🇧", code: "EN", other: "fr" as const }
    : { flag: "🇫🇷", code: "FR", other: "en" as const };
  const pill = el("button", {
    type: "button",
    class: "lang-pill",
    "aria-label": t("Change language (FR / EN)"),
    title: t("Change language (FR / EN)"),
  }, [
    el("span", { "aria-hidden": "true" }, [current.flag]),
    el("span", {}, [current.code]),
  ]);
  pill.addEventListener("click", () => void switchLanguage(current.other));
  return pill;
}

/**
 * The language choice, in the phone's account sheet: two finger-sized buttons,
 * where the choice has the room and the thumb needs a target.
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
  for (const { path, nav: destination } of destinations("main", audienceOf(user))) {
    nav.append(link(path, destination.label, "nav-link"));
  }

  const service = SERVICE_LABELS[serviceState];

  return el("header", { class: "app-bar" }, [
    el("div", { class: "app-bar-left" }, [
      el("a", { class: "brand", href: "/" }, ["ATEM"]),
      nav,
    ]),
    el("div", { class: "app-bar-right" }, [
      languagePill(),
      ...(audienceOf(user) === "player" ? [inboxBell()] : []),
      el("span", { class: `api-pill ${service.className}` }, [t(service.text)]),
      userMenu(user, signal),
    ]),
  ]);
}

/**
 * The account, on a wide screen: your avatar opens a menu.
 *
 * The earlier prototype's user menu: a round
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
  for (const { path, nav: destination } of destinations("account", audienceOf(user))) {
    menu.append(
      el("a", { class: "menu-item", role: "menuitem", href: path }, [
        el("span", { "aria-hidden": "true" }, [destination.icon]),
        " ",
        t(destination.label),
      ]),
    );
  }
  menu.append(
    el("a", { class: "menu-item", role: "menuitem", href: SOURCE_URL, target: "_blank", rel: "noopener" }, [
      el("span", { "aria-hidden": "true" }, ["📖"]), " ", t("Source code"),
    ]),
  );
  menu.append(el("div", { class: "menu-sep", role: "separator" }));

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
  // The earlier prototype's menus already followed. Toggling `hidden` instead opens nothing.
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
  const user = knownUser()!;
  const nav = el("nav", { class: "global-mobile-bottom-nav", "aria-label": t("Navigation") });
  for (const { path, nav: destination } of destinations("main", audienceOf(user))) {
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
  // The inbox leads the list, as in the earlier prototype: it is the one entry whose content
  // changes on its own, and the only one that can be waiting for you.
  if (audienceOf(user) === "player") {
    list.append(
      el("a", { class: "account-sheet-item", href: "/inbox" }, [
        el("span", { "aria-hidden": "true" }, ["📬"]),
        el("span", {}, [t("Inbox")]),
        ...(unread > 0 ? [el("span", { class: "account-sheet-count" }, [unread > 9 ? "9+" : String(unread)])] : []),
        el("span", { class: "account-sheet-chev", "aria-hidden": "true" }, ["›"]),
      ]),
    );
  }
  for (const { path, nav: destination } of destinations("account", audienceOf(user))) {
    list.append(
      el("a", { class: "account-sheet-item", href: path }, [
        el("span", { "aria-hidden": "true" }, [destination.icon]),
        el("span", {}, [t(destination.label)]),
        el("span", { class: "account-sheet-chev", "aria-hidden": "true" }, ["›"]),
      ]),
    );
  }
  list.append(
    el("a", { class: "account-sheet-item", href: SOURCE_URL, target: "_blank", rel: "noopener" }, [
      el("span", { "aria-hidden": "true" }, ["📖"]),
      el("span", {}, [t("Source code")]),
      el("span", { class: "account-sheet-chev", "aria-hidden": "true" }, ["›"]),
    ]),
  );
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

  // A rebuild that waited for the sheet to close now has its turn.
  if (pendingRender) {
    pendingRender = false;
    renderNavigation();
  }
}

export async function signOutNow(): Promise<void> {
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

/**
 * A rebuild asked for while the account sheet was open.
 *
 * The bar is rebuilt every minute by the service and inbox polls, and rebuilding
 * destroys the sheet — so a poll firing while someone had it open closed it
 * under their finger, mid-gesture. The rebuild waits for the sheet to close,
 * which is the only moment it costs nothing.
 */
let pendingRender = false;

export function renderNavigation(): void {
  const openSheet = document.querySelector<HTMLElement>("#account-sheet");
  if (openSheet && !openSheet.hidden) {
    pendingRender = true;
    return;
  }

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
  // navigate — nor has the forced password change, which leads nowhere else.
  const user = knownUser();
  if (!user || user.mustChangePassword) return;

  const { backdrop, sheet } = accountSheet();
  document.body.prepend(appBar(navigationListeners.signal));
  document.body.append(bottomNav(), backdrop, sheet);
}
