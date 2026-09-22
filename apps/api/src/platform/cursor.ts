/**
 * A page cursor: the last row's date and identifier.
 *
 * Shared by every list that pages newest first — past duels, the console's
 * accounts and its log. The pair orders rows without missing one when two
 * share a moment.
 */
import { requireUuid } from "./identifiers.js";

export type Cursor = { at: string; id: string };

/**
 * A cursor is a date and an identifier; anything else is simply no cursor.
 *
 * The date travels as the text it came in: inside a hand-written fragment the
 * driver has no column to infer a `Date` from, and refuses it — measured on
 * 2026-09-19, as a 500 on the second page. Compare with
 * `(column, id) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)`.
 */
export function parseCursor(cursor: string | undefined): Cursor | null {
  if (!cursor) return null;
  const [at, id] = cursor.split("|");
  if (!at || !id) return null;
  if (Number.isNaN(new Date(at).getTime())) return null;
  return { at, id: requireUuid(id) };
}

export const cursorAfter = (at: Date, id: string): string => `${at.toISOString()}|${id}`;
