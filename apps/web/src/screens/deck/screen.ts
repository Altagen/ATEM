/**
 * L'écran des decks — la liste, et l'atelier.
 *
 * **Le serveur décide, l'écran explique.** Les boutons se grisent avec la même
 * fonction que celle qui refuse l'écriture — `checkDeckAdd`, dans
 * `@atem/shared`. C'est ce qui manquait à ATEM-old : il avait le bon calcul et
 * ne s'en servait que pour l'affichage, si bien qu'une requête forgée passait.
 */
import { DECK_ZONES, type DeckZone } from "@atem/shared";
import { api, ApiError, type CardDetail } from "../../platform/api.js";
import { t } from "../../platform/i18n/index.js";
import { toast } from "../../platform/ui.js";
import { deckHtml, zoneFor } from "./view.js";
import {
  aggregateByCard, deckState, resetView, type DeckDetail, type DeckSummary,
} from "./state.js";

/** Ce que la collection rend, tel que l'atelier en a besoin. */
type CollectionItem = { card: CardDetail | null; quantity: number };

export async function deckScreen(root: HTMLElement, params: URLSearchParams): Promise<void> {
  const state = deckState();
  resetView();
  root.className = "deck-page-root";

  function paint(): void {
    /**
     * La saisie en cours survit à la repeinture.
     *
     * Même leçon que sur les scanlistes : une réponse qui arrive pendant qu'on
     * tape reconstruit le champ et emporte la frappe. Ici la recherche est
     * différée, donc la fenêtre est courte — mais elle existe.
     */
    const champ = root.querySelector<HTMLInputElement>("#deck-search");
    const saisie = champ ? { value: champ.value, focus: document.activeElement === champ } : null;

    root.innerHTML = deckHtml(state).toString();
    bind();

    if (!saisie?.focus) return;
    const frais = root.querySelector<HTMLInputElement>("#deck-search");
    if (!frais) return;
    frais.value = saisie.value;
    frais.focus();
    frais.setSelectionRange(saisie.value.length, saisie.value.length);
  }

  const dire = (err: unknown, repli: string): void => {
    state.error = err instanceof ApiError ? err.message : t(repli);
    paint();
  };

  async function loadList(): Promise<void> {
    try {
      const { items } = await api<{ items: DeckSummary[] }>("/decks");
      state.decks = items;
      state.error = "";
    } catch (err) {
      dire(err, "Serveur injoignable.");
      return;
    } finally {
      state.loading = false;
    }
    paint();
  }

  /**
   * La collection, **agrégée par carte**.
   *
   * L'API rend des impressions ; un deck compte des cartes. On demande une page
   * large plutôt que tout : une collection de huit cents lignes n'a pas à
   * traverser le réseau pour qu'on y pioche trois cartes, et la recherche fait
   * le reste.
   */
  async function loadCollection(): Promise<void> {
    const params = new URLSearchParams({ limit: "200", sort: "name", sortDir: "asc" });
    if (state.query.trim()) params.set("q", state.query.trim());

    try {
      const { items } = await api<{ items: CollectionItem[] }>(`/collection?${params}`);
      const banlist = new Map(
        items.filter((item) => item.card).map((item) => [item.card!.passcode, item.card!.banlistTcg]),
      );
      state.collection = aggregateByCard(items, (passcode) => banlist.get(passcode) ?? null);
    } catch (err) {
      dire(err, "Serveur injoignable.");
    }
  }

  async function loadDeck(id: string): Promise<void> {
    try {
      state.opened = await api<DeckDetail>(`/decks/${encodeURIComponent(id)}`);
      state.error = "";
    } catch (err) {
      dire(err, "Deck introuvable.");
      return;
    } finally {
      state.loading = false;
    }
    await loadCollection();
    paint();
  }

  /** Pose une quantité, et reprend le deck tel que le serveur le rend. */
  async function setCard(passcode: number, zone: DeckZone, quantity: number): Promise<void> {
    const deck = state.opened;
    if (!deck) return;
    try {
      state.opened = await api<DeckDetail>(`/decks/${encodeURIComponent(deck.id)}/cartes`, {
        method: "PUT",
        body: { passcode, zone, quantity },
      });
      state.error = "";
      paint();
    } catch (err) {
      // Le refus du serveur porte sa raison : on la montre telle quelle plutôt
      // que d'en inventer une.
      toast(err instanceof ApiError ? err.message : t("L'enregistrement a échoué."), "error");
    }
  }

  async function createDeck(): Promise<void> {
    const nom = window.prompt(t("Nom du deck"))?.trim();
    if (!nom) return;
    try {
      const deck = await api<DeckSummary>("/decks", { method: "POST", body: { name: nom } });
      toast(t("« {nom} » créé.", { nom: deck.name }), "success");
      window.history.pushState({}, "", `/decks?deck=${deck.id}`);
      state.loading = true;
      await loadDeck(deck.id);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("L'enregistrement a échoué."), "error");
    }
  }

  async function renameDeck(): Promise<void> {
    const deck = state.opened;
    if (!deck) return;
    const nom = window.prompt(t("Nom du deck"), deck.name)?.trim();
    if (!nom || nom === deck.name) return;
    try {
      await api(`/decks/${encodeURIComponent(deck.id)}`, { method: "PATCH", body: { name: nom } });
      await loadDeck(deck.id);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("L'enregistrement a échoué."), "error");
    }
  }

  async function deleteDeck(): Promise<void> {
    const deck = state.opened;
    if (!deck) return;
    if (!window.confirm(t("Jeter « {nom} » ? Le deck sera perdu.", { nom: deck.name }))) return;
    try {
      await api(`/decks/${encodeURIComponent(deck.id)}`, { method: "DELETE" });
      toast(t("« {nom} » jeté.", { nom: deck.name }), "success");
      window.history.pushState({}, "", "/decks");
      state.opened = null;
      state.loading = true;
      await loadList();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("La suppression a échoué."), "error");
    }
  }

  let chercheApres: number | undefined;

  function bind(): void {
    root.querySelector("#deck-new")?.addEventListener("click", () => void createDeck());
    root.querySelector("#deck-rename")?.addEventListener("click", () => void renameDeck());
    root.querySelector("#deck-delete")?.addEventListener("click", () => void deleteDeck());

    const recherche = root.querySelector<HTMLInputElement>("#deck-search");
    recherche?.addEventListener("input", () => {
      window.clearTimeout(chercheApres);
      // On attend que la frappe se calme : sans ça, « Magicien Sombre » lance
      // quinze requêtes dont quatorze sont jetées.
      chercheApres = window.setTimeout(() => {
        state.query = recherche.value;
        void loadCollection().then(paint);
      }, 250);
    });
  }

  /**
   * Les gestes délégués, posés **une seule fois** au montage.
   *
   * Dans `bind()`, rappelé à chaque repeinture, l'écouteur s'accumulerait et un
   * « +1 » en vaudrait trois après trois repeintures. Le défaut a déjà été
   * corrigé sur la grille de collection et sur la scanliste ; il ne coûte rien
   * de ne pas le refaire une troisième fois.
   */
  root.addEventListener("click", (event) => {
    const cible = event.target as HTMLElement | null;

    const panneau = cible?.closest<HTMLElement>("[data-panel]");
    if (panneau?.dataset.panel) {
      state.panel = panneau.dataset.panel === "zones" ? "zones" : "collection";
      paint();
      return;
    }

    const onglet = cible?.closest<HTMLElement>("[data-zone]");
    if (onglet?.dataset.zone && DECK_ZONES.includes(onglet.dataset.zone as DeckZone)) {
      state.zone = onglet.dataset.zone as DeckZone;
      paint();
      return;
    }

    const ajout = cible?.closest<HTMLElement>(".js-add");
    if (ajout?.dataset.pc) {
      const passcode = Number(ajout.dataset.pc);
      const carte = state.collection.find((c) => c.passcode === passcode);
      const entrée = state.opened?.cards.find((c) => c.passcode === passcode);
      if (!carte) return;
      /**
       * L'onglet dit où va le « + », **sauf pour l'Extra Deck**.
       *
       * Un monstre Fusion, Synchro, Xyz ou Lien y va toujours : c'est la règle
       * du jeu, et le serveur refuserait de le poser ailleurs. Laisser
       * l'utilisateur essayer pour lui répondre non serait une question posée
       * pour rien.
       */
      const zone = zoneFor(carte, state.zone);
      void setCard(passcode, zone, (entrée?.[zone] ?? 0) + 1);
      return;
    }

    const pas = cible?.closest<HTMLElement>(".js-zone");
    if (pas?.dataset.pc) {
      const passcode = Number(pas.dataset.pc);
      const entrée = state.opened?.cards.find((c) => c.passcode === passcode);
      if (!entrée) return;
      const suivante = Math.max(0, entrée[state.zone] + Number(pas.dataset.d ?? "1"));
      void setCard(passcode, state.zone, suivante);
    }
  });

  paint();

  const id = params.get("deck");
  await (id ? loadDeck(id) : loadList());
}
