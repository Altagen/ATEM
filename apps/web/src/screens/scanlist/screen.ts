/**
 * The scanlists screen.
 *
 * **It reuses the scanner without modifying it.** The scanner knows neither the
 * collection nor batches: it reads a code and reports the gesture to whoever
 * asked. Here that gesture writes into a counter living in memory — which is
 * what makes this screen's “−1” structurally unable to touch the collection.
 * There is no path, not even by mistake.
 */
import { t } from "../../platform/i18n/index.js";
import { api, ApiError, type CardDetail } from "../../platform/api.js";
import { toast } from "../../platform/ui.js";
import type { ScanlistDetail, ScanlistSummary } from "@atem/shared";
import { keptForSaving, SCANLIST_EXPORT_VERSION } from "@atem/shared";
import { scanlistHtml } from "./view.js";
import {
  applyToDraft, discardDraft, draftCopies, nameDraftLine, resetView, scanlistState, startDraft,
} from "./state.js";

/**
 * How long the catalogue is given to name a card.
 *
 * The addition never waits for it: the line enters right away with its set
 * code, which the browser already holds. If the name arrives before this delay
 * is over, it lands on the line; otherwise the code stays, and that is fine —
 * refusing to inventory a card because we cannot name it yet would be absurd. A
 * code unknown to YGOPRODeck will never be named anyway.
 */
const NAME_TIMEOUT_MS = 2_500;

export async function scanlistScreen(root: HTMLElement, params: URLSearchParams): Promise<void> {
  const state = scanlistState();
  resetView();
  root.className = "scanlist-page-root";

  /**
   * Repaints the screen **without erasing what is being typed**.
   *
   * A card's name arrives later and triggers a repaint. If it lands while the
   * next code is being typed, the field is rebuilt empty and the keystrokes are
   * lost — with nothing explaining it, and at the worst moment: while working
   * through a pile of cards.
   *
   * So we give the field back its value, its focus and the caret position. The
   * batch's name lives in the state and rewrites itself.
   */
  function paint(): void {
    const field = root.querySelector<HTMLInputElement>("#draft-code");
    const typed = field
      ? { value: field.value, focus: document.activeElement === field, caret: field.selectionStart }
      : null;

    root.innerHTML = scanlistHtml(state).toString();
    bind();

    if (!typed?.value && !typed?.focus) return;
    const fresh = root.querySelector<HTMLInputElement>("#draft-code");
    if (!fresh) return;
    fresh.value = typed.value;
    if (typed.focus) {
      fresh.focus();
      const position = typed.caret ?? typed.value.length;
      fresh.setSelectionRange(position, position);
    }
  }

  async function loadList(): Promise<void> {
    try {
      const { items } = await api<{ items: ScanlistSummary[] }>("/scanlists");
      state.items = items;
    } catch (err) {
      state.error = err instanceof ApiError ? err.message : t("Server unreachable.");
    } finally {
      state.loading = false;
      paint();
    }
  }

  async function loadOne(id: string): Promise<void> {
    try {
      state.opened = await api<ScanlistDetail>(`/scanlists/${encodeURIComponent(id)}`);
    } catch (err) {
      state.error = err instanceof ApiError ? err.message : t("Batch not found.");
    } finally {
      state.loading = false;
      paint();
    }
  }

  /**
   * Fetches the name, without ever holding the addition back.
   *
   * The call carries on server-side even if we stop waiting for it — the
   * referential is enriched anyway, to the benefit of the next card in the same
   * batch.
   */
  function resolveName(setCode: string): void {
    void api<{ card: CardDetail | null }>(
      `/catalogue/impressions/${encodeURIComponent(setCode)}`,
      { signal: AbortSignal.timeout(NAME_TIMEOUT_MS) },
    )
      .then(({ card }) => {
        if (card && nameDraftLine(setCode, card.name, card.passcode)) paint();
      })
      .catch(() => {
        // Timed out, unknown code, no network: the set code stays displayed,
        // and it already says the essential.
      });
  }

  function addToDraft(rawCode: string, delta: number): { setCode: string; quantity: number; label: string | null } {
    const setCode = rawCode.trim().toUpperCase();
    if (!setCode) throw new Error(t("No set code to record."));

    const knownBefore = state.draft?.lines.some((line) => line.setCode === setCode) ?? false;
    const line = applyToDraft(setCode, delta);
    if (!knownBefore) resolveName(setCode);
    paint();
    return { setCode: line.setCode, quantity: line.quantity, label: line.name };
  }

  async function save(): Promise<void> {
    const draft = state.draft;
    if (!draft) return;

    const name = draft.name.trim();
    if (!name) {
      state.error = t("Give the batch a name.");
      paint();
      return;
    }
    const lines = keptForSaving(draft.lines);
    if (lines.length === 0) {
      state.error = t("Nothing to save — every line is at zero.");
      paint();
      return;
    }

    try {
      const batch = await api<ScanlistDetail>("/scanlists", { method: "POST", body: { name, lines } });
      discardDraft();
      state.error = "";
      toast(t("“{name}” saved — ×{copies}", { name: batch.name, copies: batch.copyCount }), "success");
      await loadList();
    } catch (err) {
      state.error = err instanceof ApiError ? err.message : t("Saving failed.");
      paint();
    }
  }

  /**
   * The file goes through a link built on the fly.
   *
   * We do not ask the server to hand back what we already have: the batch is in
   * memory, and the browser knows how to make a file.
   */
  function exportOpened(): void {
    const batch = state.opened;
    if (!batch) return;

    const payload = JSON.stringify(
      {
        version: SCANLIST_EXPORT_VERSION,
        name: batch.name,
        createdAt: batch.createdAt,
        pouredAt: batch.pouredAt,
        lines: batch.lines,
      },
      null,
      2,
    );

    const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${batch.name.replace(/[^\w\-]+/g, "-").toLowerCase()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function pourOpened(): Promise<void> {
    const batch = state.opened;
    if (!batch || batch.pouredAt) return;
    state.pourErrors = [];

    const button = root.querySelector<HTMLButtonElement>("#batch-pour");
    if (button) button.disabled = true;
    try {
      const report = await api<{
        poured: number;
        failed: number;
        errors: { setCode: string; error: string }[];
      }>(`/scanlists/${encodeURIComponent(batch.id)}/pour`, { method: "POST" });
      // Kept for the screen: counting them without naming them leaves nothing to do.
      state.pourErrors = report.errors;
      // A half-successful pour reads as such, not as a success.
      toast(
        report.failed > 0
          ? t("×{copies} poured · {n} line(s) failed", { copies: report.poured, n: report.failed })
          : t("×{copies} poured into your collection.", { copies: report.poured }),
        report.failed > 0 ? "error" : "success",
      );
      await loadOne(batch.id);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("Pouring failed."), "error");
      if (button) button.disabled = false;
    }
  }

  async function deleteOpened(): Promise<void> {
    const batch = state.opened;
    if (!batch) return;
    if (!window.confirm(t("Discard “{name}”? This list will be lost.", { name: batch.name }))) return;

    try {
      await api(`/scanlists/${encodeURIComponent(batch.id)}`, { method: "DELETE" });
      toast(t("“{name}” discarded.", { name: batch.name }), "success");
      window.history.pushState({}, "", "/scanlists");
      state.opened = null;
      await loadList();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("Deletion failed."), "error");
    }
  }

  function bind(): void {
    root.querySelector("#draft-start")?.addEventListener("click", () => {
      startDraft();
      paint();
    });
    root.querySelector("#draft-discard")?.addEventListener("click", () => {
      const draft = state.draft;
      if (draft && draftCopies(draft) > 0 && !window.confirm(t("Discard this batch? It will be lost."))) {
        return;
      }
      discardDraft();
      state.error = "";
      paint();
    });

    const nameInput = root.querySelector<HTMLInputElement>("#draft-name");
    nameInput?.addEventListener("input", () => {
      if (state.draft) state.draft.name = nameInput.value;
    });

    const codeInput = root.querySelector<HTMLInputElement>("#draft-code");
    const addTyped = (): void => {
      const entered = codeInput?.value.trim();
      if (!entered) return;
      // Cleared **before** the repaint: the repaint restores what it finds in
      // the field, and leaving the code there would make it reappear.
      if (codeInput) codeInput.value = "";
      try {
        addToDraft(entered, 1);
        // Keyboard entry keeps the focus: here the user is typing, they do not
        // keep a finger on the screen, and the next field is this one.
        root.querySelector<HTMLInputElement>("#draft-code")?.focus();
      } catch (err) {
        state.error = err instanceof Error ? err.message : t("Cannot add.");
        paint();
      }
    };
    root.querySelector("#draft-add")?.addEventListener("click", addTyped);
    codeInput?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        addTyped();
      }
    });

    root.querySelector("#draft-save")?.addEventListener("click", () => void save());

    root.querySelector("#draft-scan")?.addEventListener("click", async () => {
      // Same on-demand loading as the collection: the engine weighs four
      // megabytes, and most visits never open the camera.
      const { openScanner } = await import("../collection/scanner.js");
      await openScanner({
        tallyLabel: t("in the batch"),
        onConfirm: async (setCode, delta) => addToDraft(setCode, delta),
        onClose: () => paint(),
      });
    });

    root.querySelector("#batch-pour")?.addEventListener("click", () => void pourOpened());
    root.querySelector("#batch-export")?.addEventListener("click", exportOpened);
    root.querySelector("#batch-delete")?.addEventListener("click", () => void deleteOpened());
  }

  /**
   * The “+” and “−” of each line, delegated **once**.
   *
   * Set at mount and not in `bind()`, which is called again on every repaint:
   * the listener would have piled up there, and one “−1” would have decremented
   * by three after three repaints. It is the defect already fixed on the
   * collection grid, and it costs nothing not to repeat it.
   */
  root.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(".js-draft");
    if (!target?.dataset.code) return;
    applyToDraft(target.dataset.code, Number(target.dataset.d ?? "1"));
    paint();
  });

  paint();

  const id = params.get("batch");
  await (id ? loadOne(id) : loadList());
}
