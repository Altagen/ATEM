/**
 * The decks screen — the list, and the workshop.
 *
 * **The server decides, the screen explains.** Buttons grey out using the same
 * function that refuses the write — `checkDeckAdd`, in `@atem/shared`. That is
 * what ATEM-old lacked: it had the right computation and used it only for
 * display, so a forged request went through.
 */
import { DECK_ZONES, type DeckZone } from "@atem/shared";
import { api, ApiError, type CardDetail } from "../../platform/api.js";
import { t } from "../../platform/i18n/index.js";
import { lockScroll, unlockScroll } from "../../platform/scroll-lock.js";
import { toast } from "../../platform/ui.js";
import { dropRefusal } from "./folders.js";
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
     * Typing under way survives the repaint.
     *
     * Same lesson as on the scanlists: an answer arriving while you type
     * rebuilds the field and carries the keystrokes away. Here the search is
     * deferred, so the window is short — but it exists.
     */
    const field = root.querySelector<HTMLInputElement>("#coll-search, #deck-search, #edit-name, #modal-name");
    const typed = field ? { value: field.value, focus: document.activeElement === field } : null;

    root.innerHTML = deckHtml(state).toString();
    bind();

    if (!typed?.focus) return;
    const fresh = root.querySelector<HTMLInputElement>("#coll-search, #deck-search, #edit-name, #modal-name");
    if (!fresh) return;
    fresh.value = typed.value;
    fresh.focus();
    fresh.setSelectionRange(typed.value.length, typed.value.length);
  }

  const fail = (err: unknown, fallback: string): void => {
    state.error = err instanceof ApiError ? err.message : t(fallback);
    paint();
  };

  /**
   * The decks and their filing, in parallel.
   *
   * One without the other would give a half-wrong screen: decks with no folder,
   * or folders with no contents, for the length of one round trip.
   */
  async function loadFiling(): Promise<void> {
    const [decks, folders] = await Promise.all([
      api<{ items: DeckSummary[] }>("/decks"),
      api<{ items: DeckFolder[] }>("/decks/folders"),
    ]);
    state.decks = decks.items;
    state.folders = folders.items;

    /**
     * The level we were on may have disappeared — it has just been deleted, or
     * moved elsewhere. We forget it **here**, where the list changes, and not
     * at drawing time: a render that repairs its own state cannot be tested,
     * and the repair ends up existing in two copies.
     */
    if (state.folderId !== null && !state.folders.some((f) => f.id === state.folderId)) {
      state.folderId = null;
    }
  }

  async function loadList(): Promise<void> {
    try {
      await loadFiling();
      state.error = "";
    } catch (err) {
      fail(err, "Server unreachable.");
      return;
    } finally {
      state.loading = false;
    }
    paint();
  }

  /** After a filing write: we read again, and redraw. */
  async function reloadFiling(): Promise<void> {
    try {
      await loadFiling();
      state.error = "";
    } catch (err) {
      fail(err, "Server unreachable.");
      return;
    }
    paint();
  }

  /**
   * The collection, **aggregated per card**.
   *
   * The API returns printings; a deck counts cards. We ask for a wide page
   * rather than everything: an eight-hundred-row collection does not have to
   * cross the network so three cards can be drawn from it, and the search does
   * the rest.
   */
  async function loadCollection(): Promise<void> {
    const params = new URLSearchParams({ limit: "200", sort: "name", sortDir: "asc" });
    if (state.query.trim()) params.set("q", state.query.trim());

    try {
      const { items } = await api<{ items: CollectionRow[] }>(`/collection?${params}`);
      state.collection = items;
      state.owned = countByCard(items);
    } catch (err) {
      fail(err, "Server unreachable.");
    }
  }

  /**
   * Opens a deck — its sheet, or its workshop.
   *
   * **The collection only leaves for the workshop.** The sheet places no cards:
   * making it cross two hundred collection rows would be paying for a screen we
   * do not show. The folders, though, are requested in both cases — the sheet
   * says where the deck is filed.
   */
  async function loadDeck(id: string): Promise<void> {
    try {
      const [deck, folders] = await Promise.all([
        api<DeckDetail>(`/decks/${encodeURIComponent(id)}`),
        api<{ items: DeckFolder[] }>("/decks/folders"),
      ]);
      state.opened = deck;
      state.folders = folders.items;
      state.error = "";
    } catch (err) {
      fail(err, "Deck not found.");
      return;
    } finally {
      state.loading = false;
    }
    if (state.editing) await loadCollection();
    paint();
  }

  let clearMarkTimer: number | undefined;

  /**
   * Lights “Saved” up, then clears it.
   *
   * Cards are written at every “±”, with no button — and nothing said so. Ange
   * removed cards, pressed “Save”, and read “Nothing to save”: enough to
   * believe the removal had been thrown away. It had not been, but the screen
   * did not say so either.
   */
  function markSaved(): void {
    const mark = Date.now();
    state.savedAt = mark;
    window.clearTimeout(clearMarkTimer);
    clearMarkTimer = window.setTimeout(() => {
      // A more recent write, or another screen: the mark is no longer ours,
      // and clearing it would repaint what does not belong to us.
      if (state.savedAt !== mark) return;
      state.savedAt = null;
      paint();
    }, 2_000);
  }

  /** Sets a quantity, and takes the deck back as the server returns it. */
  async function setCard(passcode: number, zone: DeckZone, quantity: number): Promise<void> {
    const deck = state.opened;
    if (!deck) return;
    try {
      state.opened = await api<DeckDetail>(`/decks/${encodeURIComponent(deck.id)}/cards`, {
        method: "PUT",
        body: { passcode, zone, quantity },
      });
      state.error = "";
      markSaved();
      paint();
    } catch (err) {
      // The server's refusal carries its reason: we show it as is rather than
      // inventing one.
      toast(err instanceof ApiError ? err.message : t("Saving failed."), "error");
    }
  }

  /**
   * Opens a window, and puts focus on the field.
   *
   * The previous `window.prompt` had neither the application's style nor room
   * for a second field — and on a phone it opens at the top of the screen, far
   * from the thumb. Asked for by Ange along with the folders.
   */
  function openWindow(modal: NonNullable<DeckState["modal"]>): void {
    state.modal = modal;
    state.menu = null;
    paint();
    const field = root.querySelector<HTMLInputElement>("#modal-name");
    field?.focus();
    field?.select();
    // The options window has no name to type: the picker is what it opens on.
    if (!field) root.querySelector<HTMLSelectElement>("#modal-target-main")?.focus();
  }

  function closeWindow(): void {
    if (state.modal === null) return;
    state.modal = null;
    paint();
  }

  /**
   * What the window writes, according to what it asked for.
   *
   * The empty name is refused here: the server refuses it too, but a round trip
   * for a field one can see is empty is a slow answer to an obvious question.
   */
  async function confirmWindow(): Promise<void> {
    const modal = state.modal;
    if (!modal) return;

    /**
     * Settled before the name check, because this window has none: reaching
     * that check would refuse the options window for a field it does not own.
     */
    if (modal.kind === "deck-options") {
      const picked = Number(
        root.querySelector<HTMLSelectElement>("#modal-target-main")?.value ?? "",
      );
      try {
        await api(`/decks/${encodeURIComponent(modal.id)}`, {
          method: "PATCH",
          body: { targetMain: picked },
        });
      } catch (err) {
        toast(err instanceof ApiError ? err.message : t("Saving failed."), "error");
        return;
      }
      state.modal = null;
      // The verdict is computed from the deck in hand, so it has to be the one
      // the server now holds — not the one we had before the write.
      await loadDeck(modal.id);
      toast(t("Deck options saved."), "success");
      return;
    }

    const name = root.querySelector<HTMLInputElement>("#modal-name")?.value.trim() ?? "";
    if (name === "") {
      toast(modal.kind === "new-deck" ? t("Give the deck a name.") : t("Give the folder a name."), "error");
      root.querySelector<HTMLInputElement>("#modal-name")?.focus();
      return;
    }

    try {
      switch (modal.kind) {
        case "new-deck": {
          const deck = await api<DeckSummary>("/decks", {
            method: "POST",
            body: { name: name, folderId: state.folderId },
          });
          state.modal = null;
          toast(t("“{name}” created.", { name: deck.name }), "success");
          window.history.pushState({}, "", `/decks?deck=${deck.id}&workshop=1`);
          state.editing = true;
          state.loading = true;
          await loadDeck(deck.id);
          return;
        }
        case "new-folder":
          await api("/decks/folders", {
            method: "POST",
            body: { name: name, parentId: state.folderId },
          });
          break;
        case "rename-folder":
          await api(`/decks/folders/${encodeURIComponent(modal.id)}`, {
            method: "PATCH",
            body: { name: name },
          });
          break;
      }
    } catch (err) {
      // The server's refusal carries its reason — the depth, the cycle, the
      // name already taken: we show it as is rather than inventing one.
      toast(err instanceof ApiError ? err.message : t("Saving failed."), "error");
      return;
    }

    state.modal = null;
    await reloadFiling();
  }

  /**
   * Enters move mode.
   *
   * Nothing moves yet: a banner opens, and the screen becomes an explorer
   * again. The destination will be **the place you find yourself in** at
   * confirmation time — that is Drive's gesture, and it avoids the tree
   * drop-down, which grows with the number of folders.
   */
  function startMove(what: DeckMoving): void {
    state.moving = what;
    state.menu = null;
    paint();
  }

  function cancelMove(): void {
    if (state.moving === null) return;
    state.moving = null;
    paint();
  }

  /**
   * Drops what is being moved into a folder — or at the root.
   *
   * A single write path for both gestures: the banner's button and the mouse
   * drop. They therefore cannot behave differently, and the refusal is checked
   * here, once, with the server's rule.
   */
  async function drop(what: DeckMoving, destination: string | null): Promise<void> {
    const refusal = dropRefusal(state, what, destination);
    if (refusal !== null) {
      toast(refusal, "error");
      return;
    }

    try {
      if (what.kind === "folder") {
        await api(`/decks/folders/${encodeURIComponent(what.id)}`, {
          method: "PATCH",
          body: { parentId: destination },
        });
      } else {
        await api(`/decks/${encodeURIComponent(what.id)}`, {
          method: "PATCH",
          body: { folderId: destination },
        });
      }
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("Saving failed."), "error");
      return;
    }

    state.moving = null;
    await reloadFiling();
  }

  /**
   * The full record of a deck card, requested when it is opened.
   *
   * Once per card only: the second opening is instant. We do not request them
   * when the deck loads — sixty full records for the ones nobody will open.
   */
  async function openCardSheet(passcode: number): Promise<void> {
    if (state.cardDetails.has(passcode)) return;
    try {
      const { card } = await api<{ card: CardDetail }>(`/catalogue/cards/${passcode}`);
      state.cardDetails.set(passcode, card);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("Server unreachable."), "error");
      return;
    }
    // It may have been closed in the meantime: repainting would reopen it.
    if (state.openedCard !== passcode) return;
    paint();
  }

  async function discardFolder(id: string): Promise<void> {
    const folder = state.folders.find((f) => f.id === id);
    if (!folder) return;
    state.menu = null;
    if (!window.confirm(t("Discard “{name}”? Its contents move up one level.", { name: folder.name }))) {
      paint();
      return;
    }
    try {
      await api(`/decks/folders/${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("Deletion failed."), "error");
      return;
    }
    await reloadFiling();
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

  let searchTimer: number | undefined;
  let nameTimer: number | undefined;

  function bind(): void {
    root.querySelector("#btn-build")
      ?.addEventListener("click", () => openWindow({ kind: "new-deck" }));
    root.querySelector("#btn-new-folder")
      ?.addEventListener("click", () => openWindow({ kind: "new-folder" }));
    root.querySelector("#modal-ok")?.addEventListener("click", () => void confirmWindow());
    root.querySelector("#modal-cancel")?.addEventListener("click", closeWindow);
    root.querySelector("#modal-close")?.addEventListener("click", closeWindow);
    root.querySelector("#modal-backdrop")?.addEventListener("click", closeWindow);
    // Enter in the field is worth the button, as everywhere else.
    root.querySelector("#modal-name")?.addEventListener("keydown", (event) => {
      if ((event as KeyboardEvent).key !== "Enter") return;
      event.preventDefault();
      void confirmWindow();
    });
    root.querySelector("#move-cancel")?.addEventListener("click", cancelMove);
    root.querySelector("#move-here")?.addEventListener("click", () => {
      if (state.moving) void drop(state.moving, state.folderId);
    });
    root.querySelector("#btn-delete")?.addEventListener("click", () => void deleteDeck());
    // Only in the workshop: the sheet is for looking, and two ways in to the
    // same window would be one too many — as for the bin.
    root.querySelector("#btn-deck-options")?.addEventListener("click", () => {
      if (state.opened) openWindow({ kind: "deck-options", id: state.opened.id });
    });

    /**
     * The list's search does not touch the network.
     *
     * We already have every deck: filtering in place answers the keystroke,
     * where a round trip would give a screen that stumbles.
     */
    const decks = root.querySelector<HTMLInputElement>("#deck-search");
    decks?.addEventListener("input", () => {
      state.query = decks.value;
      paint();
    });

    /**
     * The name is written like the cards: **with no button**.
     *
     * Ange: “either you update everything or you update nothing, but not just
     * half of it”. A workshop where cards left at the “±” and where the name
     * waited for a button forced you to guess which of the two halves was safe
     * — and that is exactly the doubt that made them write it.
     *
     * Typing is not a discrete gesture like a “±”: we wait for it to settle,
     * otherwise “Dragon” would be written six times. And we also write when the
     * field hands focus back, so that clicking elsewhere leaves nothing
     * pending.
     */
    const name = root.querySelector<HTMLInputElement>("#edit-name");
    name?.addEventListener("input", () => {
      window.clearTimeout(nameTimer);
      nameTimer = window.setTimeout(() => void saveName(name.value), 700);
    });
    name?.addEventListener("blur", () => {
      window.clearTimeout(nameTimer);
      void saveName(name.value);
    });
    name?.addEventListener("keydown", (event) => {
      // Enter means “I am done”: handing focus back writes, without waiting
      // for the typing delay.
      if (event.key === "Enter") {
        event.preventDefault();
        name.blur();
      }
    });

    const coll = root.querySelector<HTMLInputElement>("#coll-search");
    coll?.addEventListener("input", () => {
      window.clearTimeout(searchTimer);
      // We wait for the typing to settle: without this, “Dark Magician” fires
      // fifteen requests, fourteen of which are thrown away.
      searchTimer = window.setTimeout(() => {
        state.query = coll.value;
        void loadCollection().then(paint);
      }, 250);
    });
  }

  /**
   * Writes the deck's name.
   *
   * **A deck always has a name**: emptied, the field takes the deck's own back
   * rather than writing an empty string the server would refuse anyway.
   *
   * We do not reload the deck for all that. One word changed, not the cards,
   * and the full round trip would carry the collection with it — at every pause
   * in the typing.
   */
  async function saveName(raw: string): Promise<void> {
    const deck = state.opened;
    if (!deck) return;

    const name = raw.trim();
    if (!name) {
      const field = root.querySelector<HTMLInputElement>("#edit-name");
      if (field) field.value = deck.name;
      toast(t("Give the deck a name."), "error");
      return;
    }
    if (name === deck.name) return;

    try {
      await api(`/decks/${encodeURIComponent(deck.id)}`, { method: "PATCH", body: { name: name } });
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("Saving failed."), "error");
      return;
    }

    // The workshop may have been left during the write: the render then
    // belongs to the next screen, and repainting over it would make it flicker.
    if (state.opened?.id !== deck.id) return;
    deck.name = name;
    markSaved();
    paint();
  }

  /**
   * The delegated gestures, set up **once only** at mount.
   *
   * In `bind()`, called again at every repaint, the listener would pile up and
   * one “+1” would count as three after three repaints. The defect has already
   * been fixed on the collection grid and on the scanlist; it costs nothing not
   * to make it a third time.
   */
  root.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;

    /**
     * A click beside it closes the “⋯” menu, and does only that.
     *
     * It is the gesture expected of any context menu: a click meant to close it
     * must not also trigger whatever was underneath.
     */
    if (state.menu !== null && !target?.closest(".folder-menu-anchor")) {
      state.menu = null;
      paint();
      return;
    }

    const menu = target?.closest<HTMLElement>("[data-menu]");
    if (menu?.dataset.menu) {
      state.menu = state.menu === menu.dataset.menu ? null : menu.dataset.menu;
      paint();
      return;
    }

    /**
     * We go down and back up one level.
     *
     * The empty attribute means the root — hence the check against `undefined`
     * and not against the string: `data-goto-folder=""` is a present attribute,
     * and it means something.
     */
    const level = target?.closest<HTMLElement>("[data-goto-folder]");
    if (level?.dataset.gotoFolder !== undefined) {
      state.folderId = level.dataset.gotoFolder || null;
      state.menu = null;
      paint();
      return;
    }

    const rename = target?.closest<HTMLElement>("[data-folder-rename]");
    if (rename?.dataset.folderRename) {
      openWindow({ kind: "rename-folder", id: rename.dataset.folderRename });
      return;
    }

    const move = target?.closest<HTMLElement>("[data-folder-move]");
    if (move?.dataset.folderMove) {
      startMove({ kind: "folder", id: move.dataset.folderMove });
      return;
    }

    const discard = target?.closest<HTMLElement>("[data-folder-delete]");
    if (discard?.dataset.folderDelete) {
      void discardFolder(discard.dataset.folderDelete);
      return;
    }

    const file = target?.closest<HTMLElement>("[data-deck-move]");
    if (file?.dataset.deckMove) {
      startMove({ kind: "deck", id: file.dataset.deckMove });
      return;
    }

    const panel = target?.closest<HTMLElement>("[data-panel]");
    if (panel?.dataset.panel) {
      state.panel = panel.dataset.panel === "zones" ? "zones" : "collection";
      paint();
      return;
    }

    /**
     * The sheet closes before anything else.
     *
     * Its backdrop covers the screen: a click on it must not go through to a
     * button underneath.
     */
    if (target?.closest("#inspect-close, #inspect-backdrop")) {
      state.openedCard = null;
      unlockScroll();
      paint();
      return;
    }

    const card = target?.closest<HTMLElement>(".js-open-card");
    if (card?.dataset.pc) {
      const passcode = Number(card.dataset.pc);
      state.openedCard = passcode;
      lockScroll();
      paint();
      // On the sheet, the row does not carry enough to detail the card: we ask
      // for it once, and the screen repaints when it arrives.
      if (!state.editing) void openCardSheet(passcode);
      return;
    }

    const sheetTab = target?.closest<HTMLElement>("[data-sheet-zone]");
    if (sheetTab?.dataset.sheetZone) {
      const zone = sheetTab.dataset.sheetZone;
      state.sheetZone = zone === "all" ? "all" : (zone as DeckZone);
      paint();
      return;
    }

    const sheetView = target?.closest<HTMLElement>("[data-sheet-view]");
    if (sheetView?.dataset.sheetView) {
      state.sheetView = sheetView.dataset.sheetView === "gallery" ? "gallery" : "list";
      paint();
      return;
    }

    const listView = target?.closest<HTMLElement>("[data-list-view]");
    if (listView?.dataset.listView) {
      state.listView = listView.dataset.listView === "gallery" ? "gallery" : "list";
      paint();
      return;
    }

    const view = target?.closest<HTMLElement>("[data-coll-view]");
    if (view?.dataset.collView) {
      state.collView = view.dataset.collView === "gallery" ? "gallery" : "list";
      paint();
      return;
    }

    const kind = target?.closest<HTMLElement>("[data-filter-kind]");
    if (kind?.dataset.filterKind !== undefined) {
      state.kind = kind.dataset.filterKind as DeckState["kind"];
      paint();
      return;
    }

    const attribute = target?.closest<HTMLElement>("[data-filter-attr]");
    if (attribute?.dataset.filterAttr) {
      const value = attribute.dataset.filterAttr;
      state.attributes = state.attributes.includes(value)
        ? state.attributes.filter((a) => a !== value)
        : [...state.attributes, value];
      paint();
      return;
    }

    const tab = target?.closest<HTMLElement>("[data-zone]");
    if (tab?.dataset.zone && DECK_ZONES.includes(tab.dataset.zone as DeckZone)) {
      state.zone = tab.dataset.zone as DeckZone;
      paint();
      return;
    }

    const gesture = target?.closest<HTMLElement>(".js-coll");
    if (gesture?.dataset.pc) {
      const passcode = Number(gesture.dataset.pc);
      const card = state.collection.find((row) => row.card?.passcode === passcode)?.card;
      const entry = state.opened?.cards.find((c) => c.passcode === passcode);
      if (!card) return;
      /**
       * The tab says where the “+” goes, **except for the Extra Deck**.
       *
       * A Fusion, Synchro, Xyz or Link monster always goes there: that is the
       * game's rule, and the server would refuse to place it elsewhere. Letting
       * the user try only to answer no would be a question asked for nothing.
       */
      const zone = zoneFor(card, state.zone);
      const delta = Number(gesture.dataset.d ?? "1");
      const next = Math.max(0, (entry?.[zone] ?? 0) + delta);
      void setCard(passcode, zone, next);
      return;
    }

    const step = target?.closest<HTMLElement>(".js-zone");
    if (step?.dataset.pc) {
      const passcode = Number(step.dataset.pc);
      const entry = state.opened?.cards.find((c) => c.passcode === passcode);
      if (!entry) return;
      const next = Math.max(0, entry[state.zone] + Number(step.dataset.d ?? "1"));
      void setCard(passcode, state.zone, next);
    }
  });

  /**
   * Drag and drop, with the mouse.
   *
   * Asked for by Ange on the desktop: that is where the gesture is natural, and
   * where ATEM-old had it. On a phone it does not exist — holding then aiming
   * is not a thumb gesture — and it is the “Move here” mode that renders the
   * same service.
   *
   * **The hover is painted without repainting.** A repaint on `dragover` would
   * replace the element the browser is currently following, and the drag would
   * break off. So we touch the class directly — the dead-CSS gate still sees
   * it, since it reads the code's strings too.
   */
  let dragged: DeckMoving | null = null;

  function dropZone(event: DragEvent): { el: HTMLElement; destination: string | null } | null {
    if (!dragged) return null;
    const el = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-drop]");
    if (!el || el.dataset.drop === undefined) return null;
    const destination = el.dataset.drop || null;
    // What would be refused does not accept the drop: the cursor says so
    // before you let go, rather than a message afterwards.
    if (dropRefusal(state, dragged, destination) !== null) return null;
    return { el, destination };
  }

  root.addEventListener("dragstart", (event) => {
    const el = (event.target as HTMLElement | null)?.closest<HTMLElement>(
      "[data-drag-deck], [data-drag-folder]",
    );
    const deck = el?.dataset.dragDeck;
    const folder = el?.dataset.dragFolder;
    if (!el || (!deck && !folder)) return;

    dragged = deck ? { kind: "deck", id: deck } : { kind: "folder", id: folder as string };
    // With no data, Firefox does not start the drag.
    event.dataTransfer?.setData("text/plain", dragged.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    el.classList.add("is-dragging");
  });

  root.addEventListener("dragend", () => {
    dragged = null;
    for (const marked of root.querySelectorAll(".is-dragging, .is-drag-over")) {
      marked.classList.remove("is-dragging", "is-drag-over");
    }
  });

  root.addEventListener("dragover", (event) => {
    const zone = dropZone(event);
    if (!zone) return;
    // Without `preventDefault`, the browser refuses the drop: that is how one
    // says “yes” in HTML.
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
    const zone = dropZone(event);
    const what = dragged;
    if (!zone || !what) return;
    event.preventDefault();
    zone.el.classList.remove("is-drag-over");
    dragged = null;
    void drop(what, zone.destination);
  });

  /**
   * Escape closes the sheet.
   *
   * The same gesture as in the collection: a modal that only closes on a click
   * forces you to aim, and your hands are on the keyboard while building.
   */
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    // Newest to oldest: the window covers the menu, which covers the sheet.
    // Escape closes what you see, not what you have forgotten.
    if (state.modal !== null) {
      closeWindow();
      return;
    }
    if (state.moving !== null) {
      cancelMove();
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
    // `signal`: this listener lives on `document`, which the router does not
    // replace. Without it, a second mount added another one, and the oldest —
    // which paints into a detached `root` — answered first.
  }, { signal });

  paint();

  const id = params.get("deck");
  // `?workshop=1`: the address says we are writing. Without it, we are looking.
  state.editing = params.get("workshop") === "1";
  await (id ? loadDeck(id) : loadList());
}
