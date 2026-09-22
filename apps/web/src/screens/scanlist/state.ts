/**
 * The scanlists' state.
 *
 * **The batch in progress never leaves the browser, and does not outlive it.**
 * Nothing is written to `localStorage`: what has not been explicitly saved dies
 * with the tab, and will have to be scanned again. That is a decision, not an
 * oversight — a half-state persisted and found three days later without knowing
 * what it holds is worth less than nothing.
 *
 * It lives here, at module level: it therefore survives an internal navigation
 * — going to check your collection and coming back does not lose the pile being
 * counted — and disappears on closing.
 */
import type { ScanlistDetail, ScanlistLine, ScanlistSummary } from "@atem/shared";

export type Draft = {
  name: string;
  lines: ScanlistLine[];
};

export type ScanlistState = {
  loading: boolean;
  items: ScanlistSummary[];
  /**
   * The lines the last pour could not place.
   *
   * The server has named them from the start; the screen only showed their
   * count. “3 lines failed” without saying which leaves nothing to do — neither
   * fixing a code nor understanding why.
   */
  pourErrors: { setCode: string; error: string }[];
  /** The batch open for reading, when the URL designates one. */
  opened: ScanlistDetail | null;
  /** The batch being built, or `null` when none has been started. */
  draft: Draft | null;
  error: string;
};

/**
 * A single object, mutated in place — **never replaced**.
 *
 * `resetView` used to reassign it while the screen held a reference taken just
 * before: its mutations then went into an orphaned object while this module's
 * functions wrote into the new one. The screen rendered, and no button did
 * anything at all.
 *
 * This object's identity is part of the contract: the rest of the module
 * assumes `scanlistState()` always returns the same one.
 */
const state: ScanlistState = {
  loading: true,
  items: [],
  pourErrors: [],
  opened: null,
  draft: null,
  error: "",
};

export const scanlistState = (): ScanlistState => state;

/**
 * Resets the view, without touching the batch in progress.
 *
 * The draft deliberately survives screen changes: going to check a card in your
 * collection does not lose the pile being counted.
 */
export function resetView(): void {
  state.loading = true;
  state.items = [];
  state.opened = null;
  state.error = "";
  // The failures belong to the pour just seen, not to the next one.
  state.pourErrors = [];
}

export function startDraft(): void {
  state.draft = { name: "", lines: [] };
}

export function discardDraft(): void {
  state.draft = null;
}

/**
 * Adds or removes a copy in the batch — **and nothing else**.
 *
 * This is the difference that defines this screen. A “−1” decrements the
 * batch's line; once at zero it stays there, visible, and further “−1” do
 * nothing. They certainly do not remove a copy from the collection: the batch
 * has no link to it until it is poured.
 *
 * The zero line stays displayed on purpose: that is what lets you see what you
 * just cancelled. It will be dropped when saving.
 */
export function applyToDraft(setCode: string, delta: number): ScanlistLine {
  const draft = state.draft ?? { name: "", lines: [] };
  state.draft = draft;

  const existing = draft.lines.find((line) => line.setCode === setCode);
  if (existing) {
    existing.quantity = Math.max(0, existing.quantity + delta);
    return existing;
  }

  const line: ScanlistLine = {
    setCode,
    name: null,
    passcode: null,
    quantity: Math.max(0, delta),
  };
  // The most recently scanned first: that is the one the eye checks.
  draft.lines.unshift(line);
  return line;
}

/** A name arriving late lands on the line, if it is still there. */
export function nameDraftLine(setCode: string, name: string, passcode: number | null): boolean {
  const line = state.draft?.lines.find((l) => l.setCode === setCode);
  if (!line || line.name) return false;
  line.name = name;
  line.passcode = passcode;
  return true;
}

export const draftCopies = (draft: Draft): number =>
  draft.lines.reduce((sum, line) => sum + line.quantity, 0);
