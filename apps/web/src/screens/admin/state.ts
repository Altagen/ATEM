/**
 * What the console holds between two paints.
 */

/** Mirrors the server's `overview` (`GET /admin/overview`). */
export type Overview = { players: number; online: number; suspended: number; registrationOpen: boolean };

/** Mirrors the server's `AdminAccount`. */
export type AdminAccount = {
  id: string;
  displayName: string;
  tag: string;
  email: string;
  createdAt: string;
  lastSeenAt: string | null;
  suspendedAt: string | null;
  mustChangePassword: boolean;
};

/** Mirrors the server's `AdminLogEntry`. */
export type AdminLogEntry = {
  id: string;
  action: "account_created" | "account_suspended" | "account_restored" | "account_deleted"
    | "registration_opened" | "registration_closed";
  targetId: string | null;
  targetLabel: string | null;
  createdAt: string;
};

export type AdminTab = "overview" | "accounts" | "log";

export type AdminState = {
  tab: AdminTab;
  /** `null` while on its way: dashes, never a guessed zero. */
  overview: Overview | null;
  accounts: AdminAccount[] | null;
  /** Where the next page of accounts starts, `null` when there is none. */
  accountsCursor: string | null;
  search: string;
  log: AdminLogEntry[] | null;
  logCursor: string | null;
  /** The creation form's fields, `null` while it is closed. */
  draft: { email: string; displayName: string; password: string } | null;
  /** The account whose deletion awaits confirmation. */
  deleting: AdminAccount | null;
  /** Gestures under way, by account: their buttons go inert. */
  busy: Set<string>;
  failure: string | null;
};

export const adminState = (): AdminState => ({
  tab: "overview",
  overview: null,
  accounts: null,
  accountsCursor: null,
  search: "",
  log: null,
  logCursor: null,
  draft: null,
  deleting: null,
  busy: new Set(),
  failure: null,
});
