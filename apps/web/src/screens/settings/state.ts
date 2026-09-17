/**
 * What the settings screen holds between two paints.
 */
import type { CsvExportFormat, ImportLineError, ParsedImport } from "@atem/shared";
import type { PublicUser } from "../../platform/api.js";

/** The panels, and the menu they are reached from. */
export type SettingsView =
  | "root" | "account" | "security" | "export" | "import" | "history" | "danger";

/**
 * The account as its owner sees it — the public shape plus the email.
 *
 * Mirrors the server's `AccountDetails`: the email only ever arrives through
 * `/auth/me/account`, which answers about the caller and nobody else.
 */
export type AccountDetails = PublicUser & { email: string };

/** What `POST /collection/import` answers — mirrors the server's `ImportResult`. */
export type ImportResult = {
  mode: "merge" | "replace";
  imported: number;
  removed: number;
  failed: number;
  errors: ImportLineError[];
};

/** One line of the history — mirrors the server's `ImportRecord`. */
export type ImportRecord = Omit<ImportResult, "errors"> & { filename: string; createdAt: string };

export type SettingsState = {
  view: SettingsView;
  /** `null` until the server has answered — the screen then shows dashes, never a guess. */
  account: AccountDetails | null;
  /** How many printings the collection holds, for the danger zone's sentences. */
  ownedCount: number | null;
  modal: "clear" | "delete" | null;
  /** The word typed to confirm erasing the collection. */
  clearWord: string;
  /** Seconds left before the erase is sent, or `null` when none is pending. */
  clearCountdown: number | null;
  deletion: { phrase: string; password: string; acknowledged: boolean };
  exportFormat: CsvExportFormat;
  /** The file chosen, read in the browser, and what reading it found — before anything is sent. */
  importFile: { name: string; text: string; preview: ParsedImport } | null;
  importMode: "merge" | "replace";
  importBusy: boolean;
  importResult: ImportResult | null;
  /** `null` until the history panel has been opened and answered. */
  history: ImportRecord[] | null;
};

export const settingsState = (): SettingsState => ({
  view: "root",
  account: null,
  ownedCount: null,
  modal: null,
  clearWord: "",
  clearCountdown: null,
  deletion: { phrase: "", password: "", acknowledged: false },
  exportFormat: "atem",
  importFile: null,
  importMode: "merge",
  importBusy: false,
  importResult: null,
  history: null,
});
