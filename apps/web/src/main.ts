import "./design/index.css";

import { t } from "./platform/i18n/index.js";
import {
  closeAccountSheet, refreshInbox, refreshServiceState, renderNavigation,
} from "./platform/navigation.js";
import { installCardBack } from "./platform/card-back.js";
import { installPasswordReveal } from "./platform/password-fields.js";
import { installFocusTrap } from "./platform/focus-trap.js";
import { releaseScroll } from "./platform/scroll-lock.js";
import {
  guardWith, onAfterRender, register, registerFallback, startRouter,
} from "./platform/router.js";
import { homeOf, knownUser, loadUser, setUser } from "./platform/session.js";
import { el, toast } from "./platform/ui.js";
import { authScreen } from "./screens/auth/screen.js";
import { changePasswordScreen } from "./screens/auth/change-password.js";
import { collectionScreen } from "./screens/collection/screen.js";
import { inboxScreen } from "./screens/inbox/screen.js";
import { adminScreen } from "./screens/admin/screen.js";
import { communityScreen } from "./screens/community/screen.js";
import { deckScreen } from "./screens/deck/screen.js";
import { duelScreen } from "./screens/duel/screen.js";
import { scanlistScreen } from "./screens/scanlist/screen.js";
import { settingsScreen } from "./screens/settings/screen.js";
import { profileScreen } from "./screens/profile/screen.js";

/**
 * The root is where “ATEM” leads, from the bar or from anywhere: it has no
 * screen of its own, the guard sends each visitor home — the sign-in without a
 * session, the collection for a player, the console for the administrator.
 * It used to be resolved once, at startup: clicked later, “ATEM” led to “page
 * not found”.
 */
register("/", async () => undefined);
register("/login", authScreen("login"));
register("/register", authScreen("register"));
/** Only reached by an account whose password the administrator set — see the guard. */
register("/change-password", changePasswordScreen, { requiresSession: true });
/**
 * A route and its place in the navigation are declared in one gesture.
 *
 * That is what makes a tab leading nowhere impossible: the destination exists
 * only because the screen exists.
 */
register("/collection", collectionScreen, {
  requiresSession: true,
  nav: { label: "Collection", icon: "🗃️", group: "main" },
});
/**
 * Scanlists have **no** navigation destination.
 *
 * They are reached from the collection's toolbar. A tab of the same rank as
 * “Collection” suggested two inventories side by side, whereas a scanlist is an
 * antechamber: a batch is filed there before deciding whether it enters the
 * collection. That is the place they had in the earlier prototype, and it carries that
 * reading.
 */
register("/scanlists", scanlistScreen, { requiresSession: true });
register("/decks", deckScreen, {
  requiresSession: true,
  nav: { label: "Decks", icon: "🃏", group: "main" },
});
register("/community", communityScreen, {
  requiresSession: true,
  nav: { label: "Community", icon: "🌐", group: "main" },
});
/**
 * The inbox has **no** navigation destination.
 *
 * It is reached from the bell in the top bar and from the first row of the
 * phone's account sheet, both of which carry the count — a plain entry beside
 * “My profile” would say nothing about what is waiting, and there would be two
 * ways in on the same screen.
 */
register("/duels", duelScreen, {
  requiresSession: true,
  nav: { label: "Duels", icon: "⚔️", group: "main" },
});
register("/inbox", inboxScreen, { requiresSession: true });
/**
 * The console: the administrator's only screen, and none of the players'.
 * The server answers “not found” to anyone else whatever the screen shows.
 */
register("/admin", adminScreen, {
  requiresSession: true,
  audience: "admin",
  nav: { label: "Administration", icon: "🛡️", group: "main" },
});
/**
 * The account group: your profile, then your settings — in that order, which is
 * the order the account sheet and the top bar's menu list them.
 *
 * Registering a screen here is the whole of the wiring: the sheet and the menu
 * read `destinations("account", …)` and already know where to show it.
 */
register("/profile", profileScreen, {
  requiresSession: true,
  nav: { label: "My profile", icon: "👤", group: "account" },
});
register("/settings", settingsScreen, {
  requiresSession: true,
  nav: { label: "Settings", icon: "⚙️", group: "account" },
});

registerFallback((root) => {
  root.append(
    el("main", { class: "collection-page" }, [
      el("section", { class: "content" }, [
        el("div", { class: "empty-state" }, [
          el("p", { class: "empty-title" }, [t("Page not found")]),
          el("p", { class: "muted" }, [el("a", { href: "/" }, [t("Back to home")])]),
        ]),
      ]),
    ]),
  );
});

/**
 * Where each account may go — the screen's side of the server's session guard,
 * which refuses the same things whatever this lets through.
 *
 * - no session: the sign-in, which brings you back where you were going;
 * - a password set by the administrator: its change, and nothing else, until
 *   the account is its owner's;
 * - the administrator: the console — it does not play (the maintainer, 2026-09-21);
 * - a player: everything but the console, which answers as if it did not exist.
 */
guardWith((route) => {
  const user = knownUser();
  if (route.path === "/") return user ? homeOf(user) : "/login";
  if (!route.requiresSession) return null;
  if (!user) {
    return `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
  }
  if (user.mustChangePassword) return route.path === "/change-password" ? null : "/change-password";
  if (route.path === "/change-password") return homeOf(user);
  return route.audience === (user.role === "admin" ? "admin" : "player") ? null : homeOf(user);
});

async function start(): Promise<void> {
  try {
    setUser(await loadUser());
  } catch {
    toast(t("The server is unreachable."), "error");
  }


  // The navigation follows the route and the session. Hooking onto clicks left
  // it one action behind: the click precedes the server's answer.
  onAfterRender(() => {
    /**
     * Changing screens carries the modals away without going through their
     * closing: the card sheet and the filter panel live in the root the router
     * replaces. Without this reset, the body would stay frozen and the next
     * page would not scroll at all.
     */
    releaseScroll();
    renderNavigation();
    // The account sheet, for its part, is attached to the page body — which the
    // router does not replace.
    closeAccountSheet();
  });
  // Installed before the first screen: a window opening on the landing route
  // would otherwise be the one that leaks.
  installFocusTrap();
  installCardBack();
  installPasswordReveal();
  startRouter();

  // The service state is read at startup, then every minute: often enough to
  // signal an outage, rarely enough to cost nothing.
  void refreshServiceState();
  void refreshInbox();
  // The service state changes rarely; what is waiting for you changes while you
  // are looking at another screen. A hidden tab asks for neither: a phone in a
  // pocket polling every five seconds is a battery bill for nothing.
  window.setInterval(() => {
    if (!document.hidden) void refreshServiceState();
  }, 60_000);
  window.setInterval(() => {
    if (!document.hidden) void refreshInbox();
  }, 5_000);
  // Coming back to the tab is the moment one wants it to be up to date.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void refreshInbox();
  });
}

void start();
