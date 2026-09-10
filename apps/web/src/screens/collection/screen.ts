/**
 * L'écran de collection.
 *
 * Le rendu vit dans `view.ts` — c'est le balisage validé d'ATEM-old. Ici, le
 * branchement : lecture de l'API, état, et délégation d'événements.
 *
 * La délégation est délibérée : la grille se redessine à chaque changement de
 * filtre, et rattacher un écouteur par bouton fuirait à chaque rendu. Un seul
 * écouteur sur le conteneur suit ce qui apparaît et disparaît.
 */
import { api, ApiError } from "../../platform/api.js";
import { lockScroll, unlockScroll } from "../../platform/scroll-lock.js";
import { toast } from "../../platform/ui.js";
import {
  buildQuery, createState, EMPTY_FACETS, writePrefs,
  type CollectionItem, type Facets, type ViewState,
} from "./state.js";
import {
  contentHtml, editionsHtml, filterPanelHtml, inspectHtml, shellHtml, type PrintRow,
} from "./view.js";

const PAGE_SIZE = 60;

export async function collectionScreen(root: HTMLElement): Promise<void> {
  const state: ViewState = createState();
  let facets: Facets = EMPTY_FACETS;
  let offset = 0;

  root.className = "collection-page-root";

  /**
   * La densité est posée sur `<body>`, pas sur la racine de l'écran.
   *
   * C'est là que les règles reprises d'ATEM-old la cherchent
   * (`body.density-compact .item`), et la déplacer demanderait de réécrire ces
   * règles pour un gain nul.
   */
  function applyDensity(): void {
    document.body.classList.toggle("density-compact", state.density === "compact");
  }
  applyDensity();

  function paint(): void {
    root.innerHTML = shellHtml(state, facets).toString();
    bindShell();
  }

  /**
   * La suite arrive quand on approche du bas.
   *
   * La pagination existait côté serveur mais rien ne la déclenchait : au-delà
   * de soixante éditions, la ligne de compte annonçait « 60/312 » et les 252
   * autres étaient inatteignables. Le balisage repris n'a pas de bouton « voir
   * plus » — un observateur au pied de la liste tient le même rôle sans rien
   * ajouter à l'écran.
   */
  let sentinelObserver: IntersectionObserver | null = null;

  function watchSentinel(): void {
    sentinelObserver?.disconnect();
    const sentinel = root.querySelector(".content > :last-child");
    if (!sentinel || state.items.length >= state.total) return;

    sentinelObserver = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      if (state.loading || state.items.length >= state.total) return;
      void load(false);
    }, { rootMargin: "600px" });
    sentinelObserver.observe(sentinel);
  }

  function repaintContent(): void {
    const content = root.querySelector(".content");
    if (content) content.innerHTML = contentHtml(state).toString();
    watchSentinel();
    const meta = root.querySelector(".meta-line span");
    if (meta) {
      meta.textContent = `${state.items.length}/${state.total} édition(s) · ${state.totalCopies} ex.`;
    }
  }

  function repaintFilters(): void {
    const panel = root.querySelector("#filter-panel");
    const backdrop = root.querySelector("#filter-backdrop");
    const wasOpen = panel instanceof HTMLElement && !panel.hidden;
    panel?.remove();
    backdrop?.remove();
    root.insertAdjacentHTML("beforeend", filterPanelHtml(state, facets).toString());
    if (wasOpen) setFilterPanel(true);
    bindFilterPanel();
  }

  async function load(reset: boolean): Promise<void> {
    if (reset) {
      offset = 0;
      state.loading = true;
      repaintContent();
    }
    try {
      const page = await api<{ items: CollectionItem[]; total: number }>(
        `/collection?${buildQuery(state, offset, PAGE_SIZE)}`,
      );
      state.items = reset ? page.items : [...state.items, ...page.items];
      state.total = page.total;
      state.totalCopies = state.items.reduce((sum, item) => sum + item.quantity, 0);
      offset += page.items.length;
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Serveur injoignable.", "error");
    } finally {
      state.loading = false;
      repaintContent();
    }
  }

  async function loadFacets(): Promise<void> {
    try {
      facets = await api<Facets>("/collection/facets");
      repaintFilters();
    } catch {
      // Sans facettes, la recherche, le tri et les niveaux fonctionnent quand
      // même : on n'empêche pas l'écran de servir parce qu'un raffinement manque.
    }
  }

  async function refreshPending(): Promise<void> {
    try {
      const status = await api<{ pending: number; unidentified: number }>(
        "/collection/resolve-status",
      );
      state.pending = status.pending + status.unidentified;
      const warn = root.querySelector(".meta-line .warn");
      if (warn) {
        warn.textContent =
          state.pending > 0 ? `${state.pending} en attente d'identification` : "";
      }
    } catch {
      state.pending = 0;
    }
  }

  async function adjust(setCode: string, delta: number): Promise<CollectionItem | null> {
    try {
      const { item } = await api<{ item: CollectionItem }>("/collection/adjust", {
        method: "POST",
        body: { setCode, delta },
      });
      return item;
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "L'ajustement a échoué.", "error");
      return null;
    }
  }

  /** Vrai quand le panneau de filtres tient le verrou de défilement. */
  let filterPanelOpen = false;

  function setFilterPanel(open: boolean): void {
    const panel = root.querySelector<HTMLElement>("#filter-panel");
    const backdrop = root.querySelector<HTMLElement>("#filter-backdrop");
    if (panel) panel.hidden = !open;
    if (backdrop) backdrop.hidden = !open;

    // Le verrou suit l'état réel, pas l'appel : `setFilterPanel(true)` est
    // rappelé à chaque puce cliquée, et compter deux fois ne se rattraperait
    // jamais.
    if (open === filterPanelOpen) return;
    filterPanelOpen = open;
    if (open) lockScroll();
    else unlockScroll();
  }

  function closeInspect(): void {
    const wasOpen = root.querySelector("#inspect-panel") !== null;
    openedPasscode = null;
    root.querySelector("#inspect-panel")?.remove();
    root.querySelector("#inspect-backdrop")?.remove();
    if (wasOpen) unlockScroll();
  }

  /** Le passcode de la fiche ouverte, pour ne pas y verser les éditions d'une autre. */
  let openedPasscode: number | null = null;

  function openInspect(id: number): void {
    const item = state.items.find((candidate) => candidate.id === id);
    if (!item) return;
    closeInspect();
    openedPasscode = item.card?.passcode ?? null;
    lockScroll();
    root.insertAdjacentHTML("beforeend", inspectHtml(item).toString());
    // La croix et le fond doivent fermer : sur téléphone il n'y a pas de touche
    // Échap, et sans ces deux écouteurs la fiche est un cul-de-sac.
    root.querySelector("#btn-save-notes")?.addEventListener("click", () => void saveNotes(id));
    root.querySelector("#inspect-close")?.addEventListener("click", closeInspect);
    root.querySelector("#inspect-backdrop")?.addEventListener("click", closeInspect);
    root.querySelector<HTMLElement>("#inspect-close")?.focus();
    if (item.card) void loadEditions(item.card.passcode, openedPasscode);
  }

  async function saveNotes(id: number): Promise<void> {
    const input = root.querySelector<HTMLInputElement>("#notes-input");
    const button = root.querySelector<HTMLButtonElement>("#btn-save-notes");
    if (!input || !button) return;

    button.disabled = true;
    try {
      const notes = input.value.trim() || null;
      await api(`/collection/${id}/notes`, { method: "PATCH", body: { notes } });
      const item = state.items.find((candidate) => candidate.id === id);
      if (item) item.notes = notes;
      toast("Note enregistrée.", "success");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "La note n'a pas pu être enregistrée.", "error");
    } finally {
      button.disabled = false;
    }
  }

  /**
   * Les autres éditions arrivent après coup.
   *
   * La fiche s'ouvre tout de suite avec ce qu'on a déjà ; la liste des éditions
   * demande un aller-retour, et la faire attendre retarderait l'ouverture pour
   * une information secondaire. Si la requête échoue, le bloc n'apparaît
   * simplement pas — la fiche reste utile sans lui.
   */
  async function loadEditions(passcode: number, forCard: number | null): Promise<void> {
    try {
      const { prints } = await api<{ prints: PrintRow[] }>(`/catalogue/cards/${passcode}`);
      const host = root.querySelector(".inspect-info-body");
      // La fiche a pu être fermée, ou **remplacée par une autre** pendant la
      // requête : comparer le nœud ne suffit pas, il est recréé à chaque
      // ouverture. C'est la carte demandée qu'on vérifie.
      if (!host || openedPasscode !== forCard || openedPasscode !== passcode) return;
      const owned = new Set(state.items.map((entry) => entry.setCode));
      host.insertAdjacentHTML("beforeend", editionsHtml(prints, owned).toString());
    } catch {
      // Information secondaire : son absence ne se signale pas.
    }
  }

  // ── Branchements ──────────────────────────────────────────────────────

  /**
   * La délégation de clic est posée **une seule fois**, au montage.
   *
   * Elle vivait dans `bindShell`, rappelé à chaque redessin — et comme la
   * racine n'est pas remplacée, contrairement à `.content`, les écouteurs
   * s'empilaient : après deux bascules de vue, un « +1 » en valait trois.
   *
   * Elle est sur la racine et non sur `.content` parce que la fiche de carte
   * est insérée à côté de `<main>`, pas dedans : son bouton « −1 » ne recevait
   * sinon jamais le clic.
   */
  root.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;

    const open = target.closest<HTMLElement>(".js-open");
    if (open?.dataset.id) {
      openInspect(Number(open.dataset.id));
      return;
    }

    const delta = target.closest<HTMLElement>(".js-delta");
    if (delta?.dataset.id) {
      void applyDelta(Number(delta.dataset.id), Number(delta.dataset.d ?? "1"));
      return;
    }

    const fav = target.closest<HTMLElement>(".js-fav");
    if (fav?.dataset.id) void toggleFavorite(Number(fav.dataset.id), fav);
  });

  let searchTimer: number | undefined;

  function bindShell(): void {
    const addInput = root.querySelector<HTMLInputElement>("#set-code");
    const search = root.querySelector<HTMLInputElement>("#filter");

    search?.addEventListener("input", () => {
      window.clearTimeout(searchTimer);
      // On attend que la frappe se calme : sans ça, « Magicien Sombre » lance
      // quinze requêtes dont quatorze sont jetées.
      searchTimer = window.setTimeout(() => {
        state.query = search.value;
        void load(true);
      }, 250);
    });

    root.querySelector("#btn-chevron")?.addEventListener("click", (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      const fields = root.querySelector<HTMLElement>("#advanced-fields");
      if (!fields) return;
      const open = fields.hidden;
      fields.hidden = !open;
      fields.classList.toggle("is-open", open);
      button.setAttribute("aria-expanded", String(open));
    });

    async function submitAdd(): Promise<void> {
      const setCode = addInput?.value.trim();
      if (!setCode) return;
      const language = root.querySelector<HTMLSelectElement>("#opt-lang")?.value || null;
      const typed = root.querySelector<HTMLInputElement>("#opt-passcode")?.value.trim();
      // Les huit chiffres en bas à gauche de la carte, quand on les a lus : ils
      // dispensent d'attendre l'identification.
      const passcode = typed && /^\d+$/.test(typed) ? Number(typed) : null;

      try {
        const { item } = await api<{ item: CollectionItem }>("/collection/adjust", {
          method: "POST",
          body: { setCode, delta: 1, language, passcode },
        });
        toast(
          item.card
            ? `${item.card.name} — ${item.quantity} ex.`
            : `${item.setCode} ajouté, identification en cours.`,
          "success",
        );
        if (addInput) {
          addInput.value = "";
          addInput.focus();
        }
        await Promise.all([load(true), refreshPending(), loadFacets()]);
      } catch (err) {
        toast(err instanceof ApiError ? err.message : "L'ajout a échoué.", "error");
      }
    }

    root.querySelector("#btn-plus")?.addEventListener("click", () => void submitAdd());
    addInput?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void submitAdd();
      }
    });

    root.querySelector("#btn-scan")?.addEventListener("click", async () => {
      // Chargé à la demande : le moteur de reconnaissance pèse quatre
      // mégaoctets, et la plupart des visites n'ouvrent jamais la caméra.
      const { openScanner } = await import("./scanner.js");
      await openScanner({
        tallyLabel: "en collection",
        onConfirm: async (setCode, delta) => {
          const item = await adjust(setCode, delta);
          if (!item) throw new Error("L'enregistrement a échoué.");
          return {
            setCode: item.setCode,
            quantity: item.quantity,
            label: item.card?.name ?? null,
            hint: item.card ? undefined : "identification en cours",
          };
        },
        onClose: () => {
          void Promise.all([load(true), refreshPending(), loadFacets()]);
        },
      });
    });

    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-view]")) {
      button.addEventListener("click", () => {
        state.view = button.dataset.view === "list" ? "list" : "gallery";
        writePrefs(state);
        paint();
      });
    }

    root.querySelector("#btn-pin")?.addEventListener("click", () => {
      state.pinned = !state.pinned;
      writePrefs(state);
      paint();
    });

    root.querySelector("#btn-more")?.addEventListener("click", () => setFilterPanel(true));

    /**
     * Un seul écouteur pour toute la racine.
     *
     * Il était posé sur `.content`, mais la fiche de carte est insérée **à côté**
     * de `<main>`, pas dedans : son bouton « −1 » ne recevait donc jamais le
     * clic. Écouter la racine couvre la grille comme la fiche.
     */
    bindFilterPanel();
  }

  async function applyDelta(id: number, delta: number): Promise<void> {
    const item = state.items.find((candidate) => candidate.id === id);
    if (!item) return;
    const updated = await adjust(item.setCode, delta);
    if (!updated) return;

    if (updated.quantity <= 0) {
      state.items = state.items.filter((candidate) => candidate.id !== id);
      state.total = Math.max(0, state.total - 1);
      closeInspect();
    } else {
      Object.assign(item, updated);
    }
    state.totalCopies = state.items.reduce((sum, entry) => sum + entry.quantity, 0);
    repaintContent();

    /**
     * Le compteur d'attente suit l'ajustement.
     *
     * Sans ça, retirer la dernière carte d'une ligne non identifiée laissait
     * « 1 en attente d'identification » à l'écran jusqu'au rechargement complet
     * — un chiffre qui ne correspondait plus à rien. Signalé par Ange après
     * avoir supprimé une carte inventée exprès.
     */
    await refreshPending();
  }

  async function toggleFavorite(id: number, button: HTMLElement): Promise<void> {
    const item = state.items.find((candidate) => candidate.id === id);
    if (!item) return;
    const next = !item.isFavorite;

    // L'état bascule avant la réponse : en inventaire continu, attendre un
    // aller-retour à chaque geste rend l'écran poussif. En cas d'échec, il
    // revient et un message le dit — on ne laisse jamais un état faux.
    item.isFavorite = next;
    button.classList.toggle("is-fav", next);
    button.setAttribute("aria-pressed", String(next));

    try {
      await api(`/collection/${id}/favorite`, { method: "PATCH", body: { isFavorite: next } });
    } catch {
      item.isFavorite = !next;
      button.classList.toggle("is-fav", !next);
      button.setAttribute("aria-pressed", String(!next));
      toast("Le favori n'a pas pu être enregistré.", "error");
    }
  }

  function bindFilterPanel(): void {
    root.querySelector("#filter-panel-close")?.addEventListener("click", () => setFilterPanel(false));
    root.querySelector("#filter-panel-done")?.addEventListener("click", () => setFilterPanel(false));
    root.querySelector("#filter-backdrop")?.addEventListener("click", () => setFilterPanel(false));

    root.querySelector<HTMLSelectElement>("#sort")?.addEventListener("change", (event) => {
      state.sort = (event.target as HTMLSelectElement).value as ViewState["sort"];
      writePrefs(state);
      void load(true);
    });

    root.querySelector<HTMLSelectElement>("#sort-dir")?.addEventListener("change", (event) => {
      state.sortDir = (event.target as HTMLSelectElement).value as ViewState["sortDir"];
      writePrefs(state);
      void load(true);
    });

    root.querySelector<HTMLSelectElement>("#cols")?.addEventListener("change", (event) => {
      state.cols = (event.target as HTMLSelectElement).value;
      writePrefs(state);
      repaintContent();
    });

    root.querySelector<HTMLSelectElement>("#density")?.addEventListener("change", (event) => {
      state.density = (event.target as HTMLSelectElement).value;
      writePrefs(state);
      applyDensity();
    });

    root.querySelector<HTMLInputElement>("#group-monster")?.addEventListener("change", (event) => {
      state.groupByMonster = (event.target as HTMLInputElement).checked;
      writePrefs(state);
      repaintContent();
    });

    root.querySelector("#btn-help-st")?.addEventListener("click", (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      const hint = root.querySelector<HTMLElement>("#help-st-hint");
      if (!hint) return;
      hint.hidden = !hint.hidden;
      button.setAttribute("aria-expanded", String(!hint.hidden));
    });

    root.querySelector("#btn-clear-filters")?.addEventListener("click", () => {
      Object.assign(state, {
        query: "", kind: "", attributes: [], races: [], frameTypes: [], properties: [],
        levels: [], ranks: [], links: [],
        rarity: "", language: "", favoritesOnly: false, unresolvedOnly: false,
      });
      paint();
      setFilterPanel(true);
      void load(true);
    });

    const panel = root.querySelector(".filter-panel-body");
    panel?.addEventListener("click", (event) => {
      const chip = (event.target as HTMLElement).closest<HTMLElement>(".chip");
      if (!chip) return;

      const toggleIn = (list: string[], value: string): string[] =>
        list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];

      const data = chip.dataset;
      if (data.filterKind !== undefined) state.kind = data.filterKind;
      else if (data.filterAttr) state.attributes = toggleIn(state.attributes, data.filterAttr);
      else if (data.filterRace) state.races = toggleIn(state.races, data.filterRace);
      else if (data.filterFrame) state.frameTypes = toggleIn(state.frameTypes, data.filterFrame);
      else if (data.filterSt) state.properties = toggleIn(state.properties, data.filterSt);
      else if (data.filterLevel) state.levels = toggleIn(state.levels, data.filterLevel);
      else if (data.filterRank) state.ranks = toggleIn(state.ranks, data.filterRank);
      else if (data.filterLink) state.links = toggleIn(state.links, data.filterLink);
      else if (data.filterRarity) state.rarity = state.rarity === data.filterRarity ? "" : data.filterRarity;
      else if (data.filterLang) state.language = state.language === data.filterLang ? "" : data.filterLang;
      else if (data.filterFav) state.favoritesOnly = !state.favoritesOnly;
      else if (data.filterUnresolved) state.unresolvedOnly = !state.unresolvedOnly;
      else return;

      repaintFilters();
      setFilterPanel(true);
      void load(true);
    });
  }

  /** Échap ferme la fiche d'abord, le panneau de filtres ensuite. */
  function onKey(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    if (root.querySelector("#inspect-panel")) {
      closeInspect();
      return;
    }
    setFilterPanel(false);
  }
  document.addEventListener("keydown", onKey);

  paint();
  await Promise.all([load(true), loadFacets(), refreshPending()]);
  root.querySelector<HTMLInputElement>("#set-code")?.focus();
}
