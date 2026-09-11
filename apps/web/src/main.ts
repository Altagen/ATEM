import "./design/index.css";

import { t } from "./platform/i18n/index.js";
import { closeAccountSheet, refreshServiceState, renderNavigation } from "./platform/navigation.js";
import { releaseScroll } from "./platform/scroll-lock.js";
import {
  guardWith, onAfterRender, register, registerFallback, startRouter,
} from "./platform/router.js";
import { knownUser, loadUser, setUser } from "./platform/session.js";
import { el, toast } from "./platform/ui.js";
import { authScreen } from "./screens/auth/screen.js";
import { collectionScreen } from "./screens/collection/screen.js";
import { scanlistScreen } from "./screens/scanlist/screen.js";

register("/connexion", authScreen("login"));
register("/inscription", authScreen("register"));
/**
 * Une route et sa place dans la navigation se déclarent d'un seul geste.
 *
 * C'est ce qui rend impossible un onglet qui mène nulle part : la destination
 * n'existe que parce que l'écran existe.
 */
register("/collection", collectionScreen, {
  requiresSession: true,
  nav: { label: "Collection", icon: "🗃️", group: "main" },
});
/**
 * Les scanlistes n'ont **pas** de destination de navigation.
 *
 * On y arrive depuis la barre d'outils de la collection. Un onglet de même
 * rang que « Collection » laissait croire à deux inventaires côte à côte,
 * alors qu'une scanliste est une antichambre : on y range un lot avant de
 * décider s'il entre en collection. C'est la place qu'elles avaient dans
 * ATEM-old, et elle porte cette lecture.
 */
register("/scanlistes", scanlistScreen, { requiresSession: true });

registerFallback((root) => {
  root.append(
    el("main", { class: "collection-page" }, [
      el("section", { class: "content" }, [
        el("div", { class: "empty-state" }, [
          el("p", { class: "empty-title" }, ["Page introuvable"]),
          el("p", { class: "muted" }, [el("a", { href: "/" }, ["Revenir à l'accueil"])]),
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
    toast(t("Le serveur est injoignable."), "error");
  }

  // La racine mène là où l'on peut aller, selon qu'il y a une session ou non.
  if (window.location.pathname === "/") {
    history.replaceState({}, "", knownUser() ? "/collection" : "/connexion");
  }

  // La navigation suit la route et la session. Se brancher sur les clics la
  // laissait en retard d'une action : le clic précède la réponse du serveur.
  onAfterRender(() => {
    /**
     * Changer d'écran emporte les modales sans passer par leur fermeture : la
     * fiche de carte et le panneau de filtres vivent dans la racine que le
     * routeur remplace. Sans cette remise à zéro, le corps resterait figé et la
     * page suivante ne défilerait plus du tout.
     */
    releaseScroll();
    renderNavigation();
    // La feuille de compte, elle, est posée sur le corps de page — que le
    // routeur ne remplace pas.
    closeAccountSheet();
  });
  startRouter();

  // L'état du service est relevé au démarrage, puis toutes les minutes : assez
  // souvent pour signaler une coupure, assez rarement pour ne rien coûter.
  void refreshServiceState();
  window.setInterval(() => void refreshServiceState(), 60_000);
}

void start();
