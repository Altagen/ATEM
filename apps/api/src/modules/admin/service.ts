/**
 * The admin module — the console of the instance's one administrator.
 *
 * Scoped with the maintainer on 2026-09-21, from the earlier prototype's console reduced to what a
 * host needs: the number of players, who may sign up, the accounts (create,
 * suspend, delete), and a log of what the administrator did. Left behind:
 * invitation codes, announcements, the audit of players' activity, the cache
 * setting, and promoting other administrators — there is only one.
 *
 * It owns one table, `admin_actions`. Accounts and the registration setting
 * are identity's, reached through its functions (R1).
 */
import { desc, sql } from "drizzle-orm";
import { cursorAfter, parseCursor } from "../../platform/cursor.js";
import type { Database } from "../../db/client.js";
import {
  accountCounts, createAccountAsAdmin, deleteAccountAsAdmin, listAccounts, registrationOpen,
  setRegistrationOpen, setSuspended, type AdminAccount,
} from "../identity/index.js";
import { adminActions } from "./schema.js";

/** Every gesture the log records. */
export const ADMIN_ACTIONS = [
  "account_created", "account_suspended", "account_restored", "account_deleted",
  "registration_opened", "registration_closed",
] as const;

export type AdminAction = (typeof ADMIN_ACTIONS)[number];

export type AdminLogEntry = {
  id: string;
  action: AdminAction;
  targetId: string | null;
  targetLabel: string | null;
  createdAt: Date;
};

/** How many lines the console shows at once; older ones come on demand. */
const LOG_PAGE = 50;

const labelOf = (account: AdminAccount) => `${account.displayName}#${account.tag}`;

async function record(db: Database, action: AdminAction, target?: AdminAccount): Promise<void> {
  await db.insert(adminActions).values({
    action,
    targetId: target?.id ?? null,
    targetLabel: target ? labelOf(target) : null,
  });
}

export async function overview(db: Database) {
  return { ...(await accountCounts(db)), registrationOpen: await registrationOpen(db) };
}

export const accounts = (db: Database, search?: string, cursor?: string) =>
  listAccounts(db, { search, cursor });

export async function createAccount(
  db: Database,
  input: { email: string; displayName: string; password: string },
): Promise<AdminAccount> {
  const account = await createAccountAsAdmin(db, input);
  await record(db, "account_created", account);
  return account;
}

export async function suspendAccount(db: Database, id: string, suspended: boolean): Promise<AdminAccount> {
  const account = await setSuspended(db, id, suspended);
  await record(db, suspended ? "account_suspended" : "account_restored", account);
  return account;
}

export async function deleteAccount(db: Database, id: string): Promise<void> {
  // Logged after the fact, with the label taken before: the account is gone,
  // and the line is how its name survives.
  const account = await deleteAccountAsAdmin(db, id);
  await record(db, "account_deleted", account);
}

export async function setRegistration(db: Database, open: boolean): Promise<boolean> {
  const before = await registrationOpen(db);
  const now = await setRegistrationOpen(db, open);
  // A line per change, not per click: saying “closed” twice changes nothing.
  if (before !== now) await record(db, now ? "registration_opened" : "registration_closed");
  return now;
}

export async function actionLog(
  db: Database,
  cursor?: string,
): Promise<{ items: AdminLogEntry[]; nextCursor: string | null }> {
  const after = parseCursor(cursor);
  const rows = await db
    .select()
    .from(adminActions)
    .where(after
      ? sql`(${adminActions.createdAt}, ${adminActions.id}) < (${after.at}::timestamptz, ${after.id}::uuid)`
      : undefined)
    .orderBy(desc(adminActions.createdAt), desc(adminActions.id))
    .limit(LOG_PAGE + 1);
  const page = rows.slice(0, LOG_PAGE);
  const last = page.at(-1);
  return {
    items: page.map((row) => ({
      id: row.id,
      action: row.action as AdminAction,
      targetId: row.targetId,
      targetLabel: row.targetLabel,
      createdAt: row.createdAt,
    })),
    nextCursor: rows.length > LOG_PAGE && last ? cursorAfter(last.createdAt, last.id) : null,
  };
}
