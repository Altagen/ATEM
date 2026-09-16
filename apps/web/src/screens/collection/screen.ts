/**
 * The collection screen.
 *
 * Rendering lives in `view.ts` — that is ATEM-old's validated markup. Here, the
 * wiring: reading the API, state, and event delegation.
 *
 * The delegation is deliberate: the grid is redrawn at every filter change, and
 * attaching one listener per button would leak at every render. A single
 * listener on the container follows what appears and disappears.
 */
import { t } from "../../platform/i18n/index.js";
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

export async function collectionScreen(
  root: HTMLElement,
  _params: URLSearchParams,
  signal: AbortSignal,
): Promise<void> {
  const state: ViewState = createState();
  let facets: Facets = EMPTY_FACETS;
  let offset = 0;

  root.className = "collection-page-root";

  /**
   * Density is set on `<body>`, not on the screen's root.
   *
   * That is where the rules taken from ATEM-old look for it
   * (`body.density-compact .item`), and moving it would mean rewriting those
   * rules for no gain.
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
   * The rest arrives as we near the bottom.
   *
   * Pagination existed server-side but nothing triggered it: past sixty
   * printings the count line announced “60/312” and the other 252 were out of
   * reach. The markup we took has no “see more” button — an observer at the
   * foot of the list plays the same part without adding anything to the screen.
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
      // The same sentence as in `view.ts`, and the same key: two diverging
      // spellings would each be translated without the other.
      meta.textContent = t("{shown}/{total} printing(s) · ×{copies}", {
        shown: state.items.length,
        total: state.total,
        copies: state.totalCopies,
      });
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
      toast(err instanceof ApiError ? err.message : t("Server unreachable."), "error");
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
      // Without facets, search, sorting and levels still work: we do not stop
      // the screen from serving because a refinement is missing.
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
      toast(err instanceof ApiError ? err.message : t("The adjustment failed."), "error");
      return null;
    }
  }

  /** True when the filter panel holds the scroll lock. */
  let filterPanelOpen = false;

  function setFilterPanel(open: boolean): void {
    const panel = root.querySelector<HTMLElement>("#filter-panel");
    const backdrop = root.querySelector<HTMLElement>("#filter-backdrop");
    if (panel) panel.hidden = !open;
    if (backdrop) backdrop.hidden = !open;

    // The lock follows the real state, not the call: `setFilterPanel(true)` is
    // called again at every chip clicked, and counting twice would never be
    // caught up with.
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

  /** The open sheet's passcode, so another card's printings do not land in it. */
  let openedPasscode: number | null = null;

  function openInspect(id: number): void {
    const item = state.items.find((candidate) => candidate.id === id);
    if (!item) return;
    closeInspect();
    openedPasscode = item.card?.passcode ?? null;
    lockScroll();
    root.insertAdjacentHTML("beforeend", inspectHtml(item).toString());
    // The cross and the backdrop must close: on a phone there is no Escape
    // key, and without those two listeners the sheet is a dead end.
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
      toast(t("Note saved."), "success");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("The note could not be saved."), "error");
    } finally {
      button.disabled = false;
    }
  }

  /**
   * The other printings arrive afterwards.
   *
   * The sheet opens right away with what we already have; the list of printings
   * needs a round trip, and waiting for it would delay the opening for
   * secondary information. If the request fails the block simply does not
   * appear — the sheet stays useful without it.
   */
  async function loadEditions(passcode: number, forCard: number | null): Promise<void> {
    try {
      const { prints } = await api<{ prints: PrintRow[] }>(`/catalogue/cards/${passcode}`);
      const host = root.querySelector(".inspect-info-body");
      // The sheet may have been closed, or **replaced by another**, during the
      // request: comparing the node is not enough, it is recreated at every
      // opening. It is the requested card that we check.
      if (!host || openedPasscode !== forCard || openedPasscode !== passcode) return;
      const owned = new Set(state.items.map((entry) => entry.setCode));
      host.insertAdjacentHTML("beforeend", editionsHtml(prints, owned).toString());
    } catch {
      // Secondary information: its absence is not reported.
    }
  }

  // ── Wiring ────────────────────────────────────────────────────────────

  /**
   * Click delegation is set up **once only**, at mount.
   *
   * It used to live in `bindShell`, called again at every redraw — and since
   * the root is not replaced, unlike `.content`, the listeners piled up: after
   * two view toggles, one “+1” counted as three.
   *
   * It sits on the root rather than on `.content` because the card sheet is
   * inserted beside `<main>`, not inside it: its “−1” button would otherwise
   * never receive the click.
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
    if (fav?.dataset.id) void toggleFavorite(Number(fav.dataset.id));
  });

  let searchTimer: number | undefined;

  function bindShell(): void {
    const addInput = root.querySelector<HTMLInputElement>("#set-code");
    const search = root.querySelector<HTMLInputElement>("#filter");

    search?.addEventListener("input", () => {
      window.clearTimeout(searchTimer);
      // We wait for the typing to settle: without this, “Dark Magician” fires
      // fifteen requests, fourteen of which are thrown away.
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
      // The eight digits at the bottom left of the card, when they have been
      // read: they spare us waiting for the identification.
      const passcode = typed && /^\d+$/.test(typed) ? Number(typed) : null;

      try {
        const { item } = await api<{ item: CollectionItem }>("/collection/adjust", {
          method: "POST",
          body: { setCode, delta: 1, language, passcode },
        });
        toast(
          item.card
            ? t("{name} — ×{n}", { name: item.card.name, n: item.quantity })
            : t("{code} added, identifying now.", { code: item.setCode }),
          "success",
        );
        if (addInput) {
          addInput.value = "";
          addInput.focus();
        }
        await Promise.all([load(true), refreshPending(), loadFacets()]);
      } catch (err) {
        toast(err instanceof ApiError ? err.message : t("Adding failed."), "error");
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
      // Loaded on demand: the recognition engine weighs four megabytes, and
      // most visits never open the camera.
      const { openScanner } = await import("./scanner.js");
      await openScanner({
        tallyLabel: t("in collection"),
        onConfirm: async (setCode, delta) => {
          const item = await adjust(setCode, delta);
          if (!item) throw new Error(t("Saving failed."));
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
     * A single listener for the whole root.
     *
     * It used to sit on `.content`, but the card sheet is inserted **beside**
     * `<main>`, not inside it: its “−1” button therefore never received the
     * click. Listening on the root covers the grid as well as the sheet.
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
     * The pending counter follows the adjustment.
     *
     * Without this, removing the last card of an unidentified row left
     * “1 awaiting identification” on screen until a full reload — a number that
     * no longer matched anything. Reported by Ange after deleting a card made
     * up on purpose.
     */
    await refreshPending();
  }

  async function toggleFavorite(id: number): Promise<void> {
    const item = state.items.find((candidate) => candidate.id === id);
    if (!item) return;
    const next = !item.isFavorite;

    /**
     * The state flips before the answer, and **the whole row follows**.
     *
     * A favourite is said in two places: the star button lights up, and a “★”
     * pill sits next to the name — in gallery view, it is a star on the
     * thumbnail. Only the button was toggled by hand: the pill appeared only at
     * the next repaint, so the screen gave two different answers about the same
     * fact. Ange read it as a favourite that had not been saved, which is the
     * reasonable conclusion — it had been, though, and it did come back after a
     * reload.
     *
     * So we repaint the list from the state, as a “+1” already does: a single
     * source of truth, and nothing left to keep in agreement by hand.
     */
    item.isFavorite = next;
    repaintContent();

    try {
      await api(`/collection/${id}/favorite`, { method: "PATCH", body: { isFavorite: next } });
    } catch {
      item.isFavorite = !next;
      repaintContent();
      toast(t("The favourite could not be saved."), "error");
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

  /** Escape closes the sheet first, the filter panel next. */
  function onKey(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    if (root.querySelector("#inspect-panel")) {
      closeInspect();
      return;
    }
    setFilterPanel(false);
  }
  // Same reason as on the decks: `document` survives the screen change, and
  // one more listener per mount ends up answering in place of the right one.
  document.addEventListener("keydown", onKey, { signal });

  paint();
  await Promise.all([load(true), loadFacets(), refreshPending()]);
  /**
   * **The field does not take focus on arrival**, and that is the whole point.
   *
   * On a phone, focus raises the keyboard: opening the collection to *look* at
   * it covered half the screen, over a field nobody had asked for. The same
   * defect was fixed on the scanner, for the same reason (`scanner.ts`).
   *
   * The rule is not “never focus”, it is **who asked**: after a code is
   * entered, the focus stays (a few lines above), because the person is already
   * typing and the next code goes in the same field. Arriving is not typing.
   */
}
