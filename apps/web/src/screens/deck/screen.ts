/**
 * L'écran des decks — la liste, et l'atelier.
 *
 * **Le serveur décide, l'écran explique.** Les boutons se grisent avec la même
 * fonction que celle qui refuse l'écriture — `checkDeckAdd`, dans
 * `@atem/shared`. C'est ce qui manquait à ATEM-old : il avait le bon calcul et
 * ne s'en servait que pour l'affichage, si bien qu'une requête forgée passait.
 */
import { DECK_ZONES, type DeckZone } from "@atem/shared";
import { api, ApiError } from "../../platform/api.js";
import { t } from "../../platform/i18n/index.js";
import { lockScroll, unlockScroll } from "../../platform/scroll-lock.js";
import { toast } from "../../platform/ui.js";
import { deckHtml, zoneFor } from "./view.js";
import {
  countByCard, deckState, resetView,
  type CollectionRow, type DeckDetail, type DeckState, type DeckSummary,
} from "./state.js";

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
    const champ = root.querySelector<HTMLInputElement>("#coll-search, #deck-search, #edit-name");
    const saisie = champ ? { value: champ.value, focus: document.activeElement === champ } : null;

    root.innerHTML = deckHtml(state).toString();
    bind();

    if (!saisie?.focus) return;
    const frais = root.querySelector<HTMLInputElement>("#coll-search, #deck-search, #edit-name");
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
      const { items } = await api<{ items: CollectionRow[] }>(`/collection?${params}`);
      state.collection = items;
      state.owned = countByCard(items);
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

  let effaceMarque: number | undefined;

  /**
   * Allume « Enregistré », puis l'efface.
   *
   * Les cartes s'écrivent à chaque « ± », sans bouton — et rien ne le disait.
   * Ange a retiré des cartes, appuyé sur « Enregistrer », et lu « Rien à
   * enregistrer » : de quoi croire que son retrait avait été jeté. Il ne
   * l'était pas, mais l'écran ne le disait pas non plus.
   */
  function marquerEnregistre(): void {
    const marque = Date.now();
    state.savedAt = marque;
    window.clearTimeout(effaceMarque);
    effaceMarque = window.setTimeout(() => {
      // Une écriture plus récente, ou un autre écran : la marque n'est plus la
      // nôtre, et l'effacer repeindrait ce qui ne nous appartient pas.
      if (state.savedAt !== marque) return;
      state.savedAt = null;
      paint();
    }, 2_000);
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
      marquerEnregistre();
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
  let nomApres: number | undefined;

  function bind(): void {
    root.querySelector("#btn-build")?.addEventListener("click", () => void createDeck());
    root.querySelector("#btn-delete")?.addEventListener("click", () => void deleteDeck());

    /**
     * La recherche de la liste ne touche pas au réseau.
     *
     * On a déjà tous les decks : filtrer sur place répond à la frappe, là où un
     * aller-retour donnerait un écran qui trébuche.
     */
    const decks = root.querySelector<HTMLInputElement>("#deck-search");
    decks?.addEventListener("input", () => {
      state.query = decks.value;
      paint();
    });

    /**
     * Le nom s'écrit comme les cartes : **sans bouton**.
     *
     * Ange : « soit tu mets tout à jour soit tu mets rien à jour mais pas
     * juste la moitié ». Un atelier où les cartes partent au « ± » et où le
     * nom attendait un bouton obligeait à deviner laquelle des deux moitiés
     * était en sûreté — et c'est exactement le doute qui l'avait fait écrire.
     *
     * Une frappe n'est pas un geste discret comme un « ± » : on attend qu'elle
     * se calme, sinon « Dragon » s'écrirait six fois. Et on écrit aussi quand
     * le champ rend la main, pour que cliquer ailleurs ne laisse rien en
     * suspens.
     */
    const nom = root.querySelector<HTMLInputElement>("#edit-name");
    nom?.addEventListener("input", () => {
      window.clearTimeout(nomApres);
      nomApres = window.setTimeout(() => void enregistrerNom(nom.value), 700);
    });
    nom?.addEventListener("blur", () => {
      window.clearTimeout(nomApres);
      void enregistrerNom(nom.value);
    });
    nom?.addEventListener("keydown", (event) => {
      // L'Entrée veut dire « j'ai fini » : rendre la main écrit, sans attendre
      // le délai de la frappe.
      if (event.key === "Enter") {
        event.preventDefault();
        nom.blur();
      }
    });

    const coll = root.querySelector<HTMLInputElement>("#coll-search");
    coll?.addEventListener("input", () => {
      window.clearTimeout(chercheApres);
      // On attend que la frappe se calme : sans ça, « Magicien Sombre » lance
      // quinze requêtes dont quatorze sont jetées.
      chercheApres = window.setTimeout(() => {
        state.query = coll.value;
        void loadCollection().then(paint);
      }, 250);
    });
  }

  /**
   * Écrit le nom du deck.
   *
   * **Un deck a toujours un nom** : vidé, le champ reprend celui du deck plutôt
   * que d'écrire une chaîne vide que le serveur refuserait de toute façon.
   *
   * On ne recharge pas le deck pour autant. C'est un mot qui a changé, pas les
   * cartes, et l'aller-retour complet emporterait la collection avec lui — à
   * chaque pause de frappe.
   */
  async function enregistrerNom(brut: string): Promise<void> {
    const deck = state.opened;
    if (!deck) return;

    const nom = brut.trim();
    if (!nom) {
      const champ = root.querySelector<HTMLInputElement>("#edit-name");
      if (champ) champ.value = deck.name;
      toast(t("Donnez un nom au deck."), "error");
      return;
    }
    if (nom === deck.name) return;

    try {
      await api(`/decks/${encodeURIComponent(deck.id)}`, { method: "PATCH", body: { name: nom } });
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("L'enregistrement a échoué."), "error");
      return;
    }

    // On a pu quitter l'atelier pendant l'écriture : le rendu appartient alors
    // à l'écran suivant, et repeindre par-dessus le ferait clignoter.
    if (state.opened?.id !== deck.id) return;
    deck.name = nom;
    marquerEnregistre();
    paint();
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

    /**
     * La fiche se referme avant tout le reste.
     *
     * Son fond couvre l'écran : un clic dessus ne doit pas traverser jusqu'à un
     * bouton en dessous.
     */
    if (cible?.closest("#inspect-close, #inspect-backdrop")) {
      state.openedCard = null;
      unlockScroll();
      paint();
      return;
    }

    const carte = cible?.closest<HTMLElement>(".js-open-card");
    if (carte?.dataset.pc) {
      state.openedCard = Number(carte.dataset.pc);
      lockScroll();
      paint();
      return;
    }

    const vueListe = cible?.closest<HTMLElement>("[data-list-view]");
    if (vueListe?.dataset.listView) {
      state.listView = vueListe.dataset.listView === "gallery" ? "gallery" : "list";
      paint();
      return;
    }

    const vue = cible?.closest<HTMLElement>("[data-coll-view]");
    if (vue?.dataset.collView) {
      state.collView = vue.dataset.collView === "gallery" ? "gallery" : "list";
      paint();
      return;
    }

    const nature = cible?.closest<HTMLElement>("[data-filter-kind]");
    if (nature?.dataset.filterKind !== undefined) {
      state.kind = nature.dataset.filterKind as DeckState["kind"];
      paint();
      return;
    }

    const attribut = cible?.closest<HTMLElement>("[data-filter-attr]");
    if (attribut?.dataset.filterAttr) {
      const valeur = attribut.dataset.filterAttr;
      state.attributes = state.attributes.includes(valeur)
        ? state.attributes.filter((a) => a !== valeur)
        : [...state.attributes, valeur];
      paint();
      return;
    }

    const onglet = cible?.closest<HTMLElement>("[data-zone]");
    if (onglet?.dataset.zone && DECK_ZONES.includes(onglet.dataset.zone as DeckZone)) {
      state.zone = onglet.dataset.zone as DeckZone;
      paint();
      return;
    }

    const geste = cible?.closest<HTMLElement>(".js-coll");
    if (geste?.dataset.pc) {
      const passcode = Number(geste.dataset.pc);
      const carte = state.collection.find((row) => row.card?.passcode === passcode)?.card;
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
      const delta = Number(geste.dataset.d ?? "1");
      const suivante = Math.max(0, (entrée?.[zone] ?? 0) + delta);
      void setCard(passcode, zone, suivante);
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

  /**
   * Échap referme la fiche.
   *
   * Le même geste que dans la collection : une modale qui ne se ferme qu'au
   * clic oblige à viser, et on a les mains sur le clavier quand on construit.
   */
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || state.openedCard === null) return;
    state.openedCard = null;
    unlockScroll();
    paint();
  });

  paint();

  const id = params.get("deck");
  await (id ? loadDeck(id) : loadList());
}
