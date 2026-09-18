import "./design/index.css";

import { t } from "./platform/i18n/index.js";
import {
  closeAccountSheet, refreshInbox, refreshServiceState, renderNavigation,
} from "./platform/navigation.js";
import { installFocusTrap } from "./platform/focus-trap.js";
import { releaseScroll } from "./platform/scroll-lock.js";
import {
  guardWith, onAfterRender, register, registerFallback, startRouter,
} from "./platform/router.js";
import { knownUser, loadUser, setUser } from "./platform/session.js";
import { el, toast } from "./platform/ui.js";
import { authScreen } from "./screens/auth/screen.js";
import { collectionScreen } from "./screens/collection/screen.js";
import { inboxScreen } from "./screens/inbox/screen.js";
import { communityScreen } from "./screens/community/screen.js";
import { deckScreen } from "./screens/deck/screen.js";
import { duelScreen } from "./screens/duel/screen.js";
import { scanlistScreen } from "./screens/scanlist/screen.js";
import { settingsScreen } from "./screens/settings/screen.js";
import { profileScreen } from "./screens/profile/screen.js";

register("/login", authScreen("login"));
register("/register", authScreen("register"));
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
 * collection. That is the place they had in ATEM-old, and it carries that
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
 * The account group: your profile, then your settings — in that order, which is
 * the order the account sheet and the top bar's menu list them.
 *
 * Registering a screen here is the whole of the wiring: the sheet and the menu
 * read `destinations("account")` and already know where to show it.
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

guardWith(() => knownUser() !== null);

async function start(): Promise<void> {
  try {
    setUser(await loadUser());
  } catch {
    toast(t("The server is unreachable."), "error");
  }

  // The root leads where one can go, depending on whether there is a session.
  if (window.location.pathname === "/") {
    history.replaceState({}, "", knownUser() ? "/collection" : "/login");
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
  startRouter();

  // The service state is read at startup, then every minute: often enough to
  // signal an outage, rarely enough to cost nothing.
  void refreshServiceState();
  void refreshInbox();
  window.setInterval(() => {
    void refreshServiceState();
    void refreshInbox();
  }, 60_000);
}

void start();
