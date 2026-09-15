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
import { lockScroll, unlockScroll } from "../../platform/scroll-lock.js";
import { toast } from "../../platform/ui.js";
import { refusDeDeposer } from "./folders.js";
import { deckHtml, zoneFor } from "./view.js";
import {
  countByCard, deckState, resetView,
  type CollectionRow, type DeckDetail, type DeckFolder, type DeckMoving, type DeckState,
  type DeckSummary,
} from "./state.js";

export async function deckScreen(
  root: HTMLElement,
  params: URLSearchParams,
  signal: AbortSignal,
): Promise<void> {
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
    const champ = root.querySelector<HTMLInputElement>("#coll-search, #deck-search, #edit-name, #modal-name");
    const saisie = champ ? { value: champ.value, focus: document.activeElement === champ } : null;

    root.innerHTML = deckHtml(state).toString();
    bind();

    if (!saisie?.focus) return;
    const frais = root.querySelector<HTMLInputElement>("#coll-search, #deck-search, #edit-name, #modal-name");
    if (!frais) return;
    frais.value = saisie.value;
    frais.focus();
    frais.setSelectionRange(saisie.value.length, saisie.value.length);
  }

  const dire = (err: unknown, repli: string): void => {
    state.error = err instanceof ApiError ? err.message : t(repli);
    paint();
  };

  /**
   * Les decks et leur rangement, en parallèle.
   *
   * L'un sans l'autre donnerait un écran à moitié faux : des decks sans
   * dossier, ou des dossiers sans contenu, le temps d'un aller-retour.
   */
  async function chargerRangement(): Promise<void> {
    const [decks, dossiers] = await Promise.all([
      api<{ items: DeckSummary[] }>("/decks"),
      api<{ items: DeckFolder[] }>("/decks/dossiers"),
    ]);
    state.decks = decks.items;
    state.folders = dossiers.items;

    /**
     * L'étage où l'on se trouvait a pu disparaître — on vient de l'effacer, ou
     * de le déplacer ailleurs. On l'oublie **ici**, là où la liste change, et
     * non au moment de dessiner : un rendu qui répare son propre état ne
     * s'éprouve pas, et la réparation finit par exister en deux exemplaires.
     */
    if (state.folderId !== null && !state.folders.some((f) => f.id === state.folderId)) {
      state.folderId = null;
    }
  }

  async function loadList(): Promise<void> {
    try {
      await chargerRangement();
      state.error = "";
    } catch (err) {
      dire(err, "Server unreachable.");
      return;
    } finally {
      state.loading = false;
    }
    paint();
  }

  /** Après une écriture de rangement : on relit, et on redessine. */
  async function relireRangement(): Promise<void> {
    try {
      await chargerRangement();
      state.error = "";
    } catch (err) {
      dire(err, "Server unreachable.");
      return;
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
      dire(err, "Server unreachable.");
    }
  }

  /**
   * Ouvre un deck — sa fiche, ou son atelier.
   *
   * **La collection ne part que pour l'atelier.** La fiche ne pose pas de
   * cartes : lui faire traverser deux cents lignes de collection serait payer
   * un écran qu'on ne montre pas. Les dossiers, eux, sont demandés dans les
   * deux cas — la fiche dit où le deck est rangé.
   */
  async function loadDeck(id: string): Promise<void> {
    try {
      const [deck, dossiers] = await Promise.all([
        api<DeckDetail>(`/decks/${encodeURIComponent(id)}`),
        api<{ items: DeckFolder[] }>("/decks/dossiers"),
      ]);
      state.opened = deck;
      state.folders = dossiers.items;
      state.error = "";
    } catch (err) {
      dire(err, "Deck not found.");
      return;
    } finally {
      state.loading = false;
    }
    if (state.editing) await loadCollection();
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
      toast(err instanceof ApiError ? err.message : t("Saving failed."), "error");
    }
  }

  /**
   * Ouvre une fenêtre, et met la main sur le champ.
   *
   * Le `window.prompt` d'avant n'avait ni le style de l'application, ni la
   * place d'un second champ — et sur un téléphone il s'ouvre en haut de
   * l'écran, loin du pouce. Demandé par Ange avec les dossiers.
   */
  function ouvrirFenetre(modal: NonNullable<DeckState["modal"]>): void {
    state.modal = modal;
    state.menu = null;
    paint();
    const champ = root.querySelector<HTMLInputElement>("#modal-name");
    champ?.focus();
    champ?.select();
  }

  function fermerFenetre(): void {
    if (state.modal === null) return;
    state.modal = null;
    paint();
  }

  /**
   * Ce que la fenêtre écrit, selon ce qu'elle demandait.
   *
   * Le nom vide est refusé ici : le serveur le refuse aussi, mais un
   * aller-retour pour un champ qu'on voit vide est une réponse lente à une
   * question évidente.
   */
  async function validerFenetre(): Promise<void> {
    const modal = state.modal;
    if (!modal) return;

    const nom = root.querySelector<HTMLInputElement>("#modal-name")?.value.trim() ?? "";
    if (nom === "") {
      toast(modal.kind === "new-deck" ? t("Give the deck a name.") : t("Give the folder a name."), "error");
      root.querySelector<HTMLInputElement>("#modal-name")?.focus();
      return;
    }

    try {
      switch (modal.kind) {
        case "new-deck": {
          const deck = await api<DeckSummary>("/decks", {
            method: "POST",
            body: { name: nom, folderId: state.folderId },
          });
          state.modal = null;
          toast(t("“{name}” created.", { name: deck.name }), "success");
          window.history.pushState({}, "", `/decks?deck=${deck.id}&atelier=1`);
          state.editing = true;
          state.loading = true;
          await loadDeck(deck.id);
          return;
        }
        case "new-folder":
          await api("/decks/dossiers", {
            method: "POST",
            body: { name: nom, parentId: state.folderId },
          });
          break;
        case "rename-folder":
          await api(`/decks/dossiers/${encodeURIComponent(modal.id)}`, {
            method: "PATCH",
            body: { name: nom },
          });
          break;
      }
    } catch (err) {
      // Le refus du serveur porte sa raison — la profondeur, le cycle, le nom
      // déjà pris : on la montre telle quelle plutôt que d'en inventer une.
      toast(err instanceof ApiError ? err.message : t("Saving failed."), "error");
      return;
    }

    state.modal = null;
    await relireRangement();
  }

  /**
   * Entre dans le mode déplacement.
   *
   * Rien ne bouge encore : on ouvre un bandeau, et l'écran redevient un
   * explorateur. La destination sera **l'endroit où l'on se trouvera** au
   * moment de valider — c'est le geste de Drive, et il évite le menu déroulant
   * d'arborescence, qui grandit avec le nombre de dossiers.
   */
  function commencerDéplacement(quoi: DeckMoving): void {
    state.moving = quoi;
    state.menu = null;
    paint();
  }

  function annulerDéplacement(): void {
    if (state.moving === null) return;
    state.moving = null;
    paint();
  }

  /**
   * Dépose ce qu'on déplace dans un dossier — ou à la racine.
   *
   * Un seul chemin d'écriture pour les deux gestes : le bouton du bandeau et le
   * dépôt à la souris. Ils ne peuvent donc pas se comporter différemment, et le
   * refus est vérifié ici, une fois, avec la règle du serveur.
   */
  async function déposer(quoi: DeckMoving, destination: string | null): Promise<void> {
    const refus = refusDeDeposer(state, quoi, destination);
    if (refus !== null) {
      toast(refus, "error");
      return;
    }

    try {
      if (quoi.kind === "folder") {
        await api(`/decks/dossiers/${encodeURIComponent(quoi.id)}`, {
          method: "PATCH",
          body: { parentId: destination },
        });
      } else {
        await api(`/decks/${encodeURIComponent(quoi.id)}`, {
          method: "PATCH",
          body: { folderId: destination },
        });
      }
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("Saving failed."), "error");
      return;
    }

    state.moving = null;
    await relireRangement();
  }

  /**
   * La fiche complète d'une carte du deck, demandée à l'ouverture.
   *
   * Une seule fois par carte : la deuxième ouverture est instantanée. On ne les
   * demande pas au chargement du deck — soixante fiches complètes pour celles
   * qu'on n'ouvrira pas.
   */
  async function ouvrirFiche(passcode: number): Promise<void> {
    if (state.cardDetails.has(passcode)) return;
    try {
      const { card } = await api<{ card: CardDetail }>(`/catalogue/cards/${passcode}`);
      state.cardDetails.set(passcode, card);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("Server unreachable."), "error");
      return;
    }
    // On a pu refermer entre-temps : repeindre rouvrirait la fiche.
    if (state.openedCard !== passcode) return;
    paint();
  }

  async function jeterDossier(id: string): Promise<void> {
    const dossier = state.folders.find((f) => f.id === id);
    if (!dossier) return;
    state.menu = null;
    if (!window.confirm(t("Discard “{name}”? Its contents move up one level.", { name: dossier.name }))) {
      paint();
      return;
    }
    try {
      await api(`/decks/dossiers/${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("Deletion failed."), "error");
      return;
    }
    await relireRangement();
  }

  async function deleteDeck(): Promise<void> {
    const deck = state.opened;
    if (!deck) return;
    if (!window.confirm(t("Discard “{name}”? The deck will be lost.", { name: deck.name }))) return;
    try {
      await api(`/decks/${encodeURIComponent(deck.id)}`, { method: "DELETE" });
      toast(t("“{name}” discarded.", { name: deck.name }), "success");
      window.history.pushState({}, "", "/decks");
      state.opened = null;
      state.loading = true;
      await loadList();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("Deletion failed."), "error");
    }
  }

  let chercheApres: number | undefined;
  let nomApres: number | undefined;

  function bind(): void {
    root.querySelector("#btn-build")
      ?.addEventListener("click", () => ouvrirFenetre({ kind: "new-deck" }));
    root.querySelector("#btn-new-folder")
      ?.addEventListener("click", () => ouvrirFenetre({ kind: "new-folder" }));
    root.querySelector("#modal-ok")?.addEventListener("click", () => void validerFenetre());
    root.querySelector("#modal-cancel")?.addEventListener("click", fermerFenetre);
    root.querySelector("#modal-close")?.addEventListener("click", fermerFenetre);
    root.querySelector("#modal-backdrop")?.addEventListener("click", fermerFenetre);
    // L'Entrée dans le champ vaut le bouton, comme partout ailleurs.
    root.querySelector("#modal-name")?.addEventListener("keydown", (event) => {
      if ((event as KeyboardEvent).key !== "Enter") return;
      event.preventDefault();
      void validerFenetre();
    });
    root.querySelector("#move-cancel")?.addEventListener("click", annulerDéplacement);
    root.querySelector("#move-here")?.addEventListener("click", () => {
      if (state.moving) void déposer(state.moving, state.folderId);
    });
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
      toast(t("Give the deck a name."), "error");
      return;
    }
    if (nom === deck.name) return;

    try {
      await api(`/decks/${encodeURIComponent(deck.id)}`, { method: "PATCH", body: { name: nom } });
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("Saving failed."), "error");
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

    /**
     * Un clic à côté referme le menu « ⋯ », et ne fait que ça.
     *
     * C'est le geste attendu de tout menu contextuel : on ne veut pas qu'un
     * clic destiné à le fermer déclenche en plus ce qui se trouvait dessous.
     */
    if (state.menu !== null && !cible?.closest(".folder-menu-anchor")) {
      state.menu = null;
      paint();
      return;
    }

    const menu = cible?.closest<HTMLElement>("[data-menu]");
    if (menu?.dataset.menu) {
      state.menu = state.menu === menu.dataset.menu ? null : menu.dataset.menu;
      paint();
      return;
    }

    /**
     * On descend et l'on remonte d'un étage.
     *
     * L'attribut vide vaut la racine — d'où le contrôle sur `undefined` et non
     * sur la chaîne : `data-goto-folder=""` est un attribut présent, et il veut
     * dire quelque chose.
     */
    const étage = cible?.closest<HTMLElement>("[data-goto-folder]");
    if (étage?.dataset.gotoFolder !== undefined) {
      state.folderId = étage.dataset.gotoFolder || null;
      state.menu = null;
      paint();
      return;
    }

    const renommer = cible?.closest<HTMLElement>("[data-folder-rename]");
    if (renommer?.dataset.folderRename) {
      ouvrirFenetre({ kind: "rename-folder", id: renommer.dataset.folderRename });
      return;
    }

    const déplacer = cible?.closest<HTMLElement>("[data-folder-move]");
    if (déplacer?.dataset.folderMove) {
      commencerDéplacement({ kind: "folder", id: déplacer.dataset.folderMove });
      return;
    }

    const jeter = cible?.closest<HTMLElement>("[data-folder-delete]");
    if (jeter?.dataset.folderDelete) {
      void jeterDossier(jeter.dataset.folderDelete);
      return;
    }

    const ranger = cible?.closest<HTMLElement>("[data-deck-move]");
    if (ranger?.dataset.deckMove) {
      commencerDéplacement({ kind: "deck", id: ranger.dataset.deckMove });
      return;
    }

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
      const passcode = Number(carte.dataset.pc);
      state.openedCard = passcode;
      lockScroll();
      paint();
      // Sur la fiche, la ligne ne porte pas de quoi détailler la carte : on la
      // demande une fois, et l'écran se repeint quand elle arrive.
      if (!state.editing) void ouvrirFiche(passcode);
      return;
    }

    const ongletFiche = cible?.closest<HTMLElement>("[data-sheet-zone]");
    if (ongletFiche?.dataset.sheetZone) {
      const zone = ongletFiche.dataset.sheetZone;
      state.sheetZone = zone === "all" ? "all" : (zone as DeckZone);
      paint();
      return;
    }

    const vueFiche = cible?.closest<HTMLElement>("[data-sheet-view]");
    if (vueFiche?.dataset.sheetView) {
      state.sheetView = vueFiche.dataset.sheetView === "gallery" ? "gallery" : "list";
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
   * Le glisser-déposer, à la souris.
   *
   * Demandé par Ange pour le bureau : c'est là que le geste est naturel, et
   * qu'ATEM-old l'avait. Sur un téléphone il n'existe pas — maintenir puis
   * viser ne se fait pas au pouce — et c'est le mode « Déplacer ici » qui rend
   * le même service.
   *
   * **Le survol se peint sans repeindre.** Une repeinture par `dragover`
   * remplacerait l'élément que le navigateur est en train de suivre, et le
   * glissement s'interromprait. On touche donc la classe directement — la
   * barrière du CSS mort la voit quand même, puisqu'elle lit aussi les chaînes
   * du code.
   */
  let glisse: DeckMoving | null = null;

  function zoneDeDepot(event: DragEvent): { el: HTMLElement; destination: string | null } | null {
    if (!glisse) return null;
    const el = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-drop]");
    if (!el || el.dataset.drop === undefined) return null;
    const destination = el.dataset.drop || null;
    // Ce qui serait refusé n'accepte pas le dépôt : le curseur le dit avant
    // qu'on lâche, plutôt qu'un message après.
    if (refusDeDeposer(state, glisse, destination) !== null) return null;
    return { el, destination };
  }

  root.addEventListener("dragstart", (event) => {
    const el = (event.target as HTMLElement | null)?.closest<HTMLElement>(
      "[data-drag-deck], [data-drag-folder]",
    );
    const deck = el?.dataset.dragDeck;
    const dossier = el?.dataset.dragFolder;
    if (!el || (!deck && !dossier)) return;

    glisse = deck ? { kind: "deck", id: deck } : { kind: "folder", id: dossier as string };
    // Sans donnée, Firefox n'ouvre pas le glissement.
    event.dataTransfer?.setData("text/plain", glisse.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    el.classList.add("is-dragging");
  });

  root.addEventListener("dragend", () => {
    glisse = null;
    for (const marqué of root.querySelectorAll(".is-dragging, .is-drag-over")) {
      marqué.classList.remove("is-dragging", "is-drag-over");
    }
  });

  root.addEventListener("dragover", (event) => {
    const zone = zoneDeDepot(event);
    if (!zone) return;
    // Sans `preventDefault`, le navigateur refuse le dépôt : c'est ainsi qu'on
    // dit « oui » en HTML.
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    zone.el.classList.add("is-drag-over");
  });

  root.addEventListener("dragleave", (event) => {
    (event.target as HTMLElement | null)
      ?.closest<HTMLElement>("[data-drop]")
      ?.classList.remove("is-drag-over");
  });

  root.addEventListener("drop", (event) => {
    const zone = zoneDeDepot(event);
    const quoi = glisse;
    if (!zone || !quoi) return;
    event.preventDefault();
    zone.el.classList.remove("is-drag-over");
    glisse = null;
    void déposer(quoi, zone.destination);
  });

  /**
   * Échap referme la fiche.
   *
   * Le même geste que dans la collection : une modale qui ne se ferme qu'au
   * clic oblige à viser, et on a les mains sur le clavier quand on construit.
   */
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    // Du plus récent au plus ancien : la fenêtre couvre le menu, qui couvre la
    // fiche. Échap referme ce qu'on voit, pas ce qu'on a oublié.
    if (state.modal !== null) {
      fermerFenetre();
      return;
    }
    if (state.moving !== null) {
      annulerDéplacement();
      return;
    }
    if (state.menu !== null) {
      state.menu = null;
      paint();
      return;
    }
    if (state.openedCard === null) return;
    state.openedCard = null;
    unlockScroll();
    paint();
    // `signal` : cet écouteur vit sur `document`, que le routeur ne remplace
    // pas. Sans lui, un second montage en ajoutait un autre, et le plus ancien
    // — qui peint dans un `root` détaché — répondait le premier.
  }, { signal });

  paint();

  const id = params.get("deck");
  // `?atelier=1` : l'adresse dit qu'on écrit. Sans lui, on regarde.
  state.editing = params.get("atelier") === "1";
  await (id ? loadDeck(id) : loadList());
}
