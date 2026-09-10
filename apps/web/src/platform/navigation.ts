/**
 * La coquille de navigation.
 *
 * Trois surfaces, un seul état :
 *
 * — la **barre du haut**, sur écran large ;
 * — la **barre du bas**, sur téléphone, qui la remplace entièrement ;
 * — la **feuille de compte**, que la barre du bas ouvre.
 *
 * Le choix de remplacer plutôt que d'adapter vient d'ATEM-old, et il tient : la
 * barre du haut ne gardait sur mobile que la marque, l'état du service et
 * l'avatar — cinq cibles dans une bande de 62 px, pour des réglages qu'on ne
 * visite pas en boucle. Le pouce, lui, est en bas de l'écran.
 *
 * **Les destinations viennent du routeur.** Aucune liste n'est tenue ici : un
 * écran déclare sa route et sa place dans la navigation d'un seul geste, et une
 * entrée qui mène nulle part devient impossible à écrire.
 */
import { api } from "./api.js";
import { destinations, navigate } from "./router.js";
import { lockScroll, unlockScroll } from "./scroll-lock.js";
import { knownUser, setUser } from "./session.js";
import { el } from "./ui.js";

type ServiceState = "ok" | "unreachable" | "unknown";

let serviceState: ServiceState = "unknown";

const SERVICE_LABELS: Record<ServiceState, { text: string; className: string }> = {
  ok: { text: "En ligne", className: "api-ok" },
  unreachable: { text: "Injoignable", className: "api-err" },
  unknown: { text: "…", className: "api-warn" },
};

/**
 * L'état du service, montré en permanence.
 *
 * Quand le serveur ne répond plus, chaque geste échoue avec un message
 * différent et l'on cherche la panne dans l'application. Une pastille qui dit
 * « injoignable » répond à la question avant qu'on la pose.
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

function link(path: string, label: string, className: string, icon?: string): HTMLElement {
  const isActive = window.location.pathname === path;
  const node = el("a", { class: className, href: path }, []);
  if (icon) node.append(el("span", { "aria-hidden": "true" }, [icon]));
  node.append(el("span", {}, [label]));
  if (isActive) {
    node.classList.add("is-active");
    node.setAttribute("aria-current", "page");
  }
  return node;
}

function appBar(): HTMLElement {
  const user = knownUser()!;
  const nav = el("nav", { class: "app-nav" });
  for (const { path, nav: destination } of destinations("main")) {
    nav.append(link(path, destination.label, "nav-link"));
  }

  const service = SERVICE_LABELS[serviceState];
  const signOut = el("button", { type: "button", class: "btn" }, ["Déconnexion"]);
  signOut.addEventListener("click", () => void signOutNow());

  return el("header", { class: "app-bar" }, [
    el("div", { class: "app-bar-left" }, [
      el("a", { class: "brand", href: "/" }, ["ATEM"]),
      nav,
    ]),
    el("div", { class: "app-bar-right" }, [
      el("span", { class: `api-pill ${service.className}` }, [service.text]),
      el("span", { class: "muted" }, [`${user.displayName} #${user.tag}`]),
      signOut,
    ]),
  ]);
}

function bottomNav(): HTMLElement {
  const nav = el("nav", { class: "global-mobile-bottom-nav", "aria-label": "Navigation" });
  for (const { path, nav: destination } of destinations("main")) {
    nav.append(link(path, destination.label, "global-mobile-nav-item", destination.icon));
  }

  const account = el("button", {
    type: "button",
    class: "global-mobile-nav-item",
    "aria-label": "Mon compte",
    "aria-haspopup": "dialog",
  }, [
    el("span", { "aria-hidden": "true" }, ["👤"]),
    el("span", {}, ["Compte"]),
  ]);
  account.addEventListener("click", () => openAccountSheet());
  nav.append(account);

  return nav;
}

/**
 * La feuille de compte.
 *
 * Elle remplace, sur téléphone, ce que la barre du haut portait à droite :
 * l'identité, l'état du service, les écrans annexes et la déconnexion.
 */
function accountSheet(): { backdrop: HTMLElement; sheet: HTMLElement } {
  const user = knownUser()!;
  const service = SERVICE_LABELS[serviceState];

  const close = el("button", { type: "button", class: "icon-btn", "aria-label": "Fermer" }, ["✕"]);
  close.addEventListener("click", closeAccountSheet);

  const list = el("nav", { class: "account-sheet-list" });
  for (const { path, nav: destination } of destinations("account")) {
    list.append(
      el("a", { class: "account-sheet-item", href: path }, [
        el("span", { "aria-hidden": "true" }, [destination.icon]),
        el("span", {}, [destination.label]),
        el("span", { class: "account-sheet-chev", "aria-hidden": "true" }, ["›"]),
      ]),
    );
  }
  // Sans destination annexe, la liste n'a rien à montrer : on ne pose pas un
  // conteneur vide qui laisserait croire à un chargement.
  if (list.childElementCount === 0) list.remove();

  const signOut = el("button", { type: "button", class: "account-sheet-logout" }, [
    "Se déconnecter",
  ]);
  signOut.addEventListener("click", () => void signOutNow());

  const sheet = el("section", {
    class: "account-sheet",
    id: "account-sheet",
    role: "dialog",
    "aria-modal": "true",
    "aria-label": "Mon compte",
    hidden: "",
  }, [
    el("span", { class: "account-sheet-grip", "aria-hidden": "true" }),
    el("header", { class: "account-sheet-head" }, [
      el("span", { class: "account-sheet-brand" }, ["ATEM"]),
      el("span", { class: "account-sheet-identity" }, [
        el("strong", {}, [`${user.displayName} #${user.tag}`]),
        el("span", { class: `api-pill ${service.className}` }, [service.text]),
      ]),
      close,
    ]),
    ...(list.isConnected || list.childElementCount > 0 ? [list] : []),
    el("footer", { class: "account-sheet-foot" }, [signOut]),
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
    // Même si le serveur n'a pas répondu, on ne laisse personne croire qu'il
    // est encore connecté : l'état local suit la demande.
    setUser(null);
    renderNavigation();
    navigate("/connexion");
  }
}

/**
 * Reconstruit la navigation.
 *
 * Tout est refait plutôt que mis à jour en place : la destination courante,
 * l'identité et l'état du service changent ensemble, et les synchroniser à la
 * main est le genre de détail qu'on finit par oublier quelque part.
 */
export function renderNavigation(): void {
  /**
   * La feuille est refermée dans les règles avant d'être reconstruite.
   *
   * Cette fonction est aussi rappelée chaque minute par le relevé d'état du
   * service : retirer la feuille sans la fermer laisserait le verrou de
   * défilement posé pour rien, et la page ne défilerait plus jamais.
   */
  closeAccountSheet();

  for (const selector of [".app-bar", ".global-mobile-bottom-nav", "#account-sheet", "#account-backdrop"]) {
    document.querySelector(selector)?.remove();
  }

  // Les écrans d'authentification portent leur propre en-tête, et n'ont rien
  // à naviguer.
  if (!knownUser()) return;

  const { backdrop, sheet } = accountSheet();
  document.body.prepend(appBar());
  document.body.append(bottomNav(), backdrop, sheet);
}
