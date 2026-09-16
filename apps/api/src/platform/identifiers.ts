/**
 * Identifiers that come from outside.
 *
 * A `uuid` column does not accept any string: PostgreSQL refuses the
 * comparison, and that refusal surfaces as an **internal error** — a 500, with
 * the failed query in the logs, for what is only a mistyped address. Same
 * family as `?level=abc`, which produced a 500 where an unreadable filter
 * deserves no more than a 400.
 *
 * So we check the shape before querying. In the service, not in the route: a
 * service is callable by something other than a route — a script, a queue, a
 * test — and its guarantee must not depend on who calls it.
 */
import { invalidInput } from "./errors.js";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Returns the identifier, or refuses the request — never a database error. */
export function requireUuid(value: string): string {
  if (!UUID.test(value)) throw invalidInput("Invalid identifier.");
  return value;
}

/**
 * A row identifier, as a `serial` column can hold it.
 *
 * `Number.isInteger` is not a range check: `1e20` is a whole number to
 * JavaScript, so it passed, and PostgreSQL then refused the comparison against
 * an `integer` column — a 500, with the query in the logs, for a mistyped
 * address. Measured during the audit of 2026-09-16 on `/catalogue/cards/…`.
 */
const INT4_MAX = 2_147_483_647;

export function requireRowId(raw: string | undefined): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > INT4_MAX) {
    throw invalidInput("Invalid identifier.");
  }
  return value;
}

/**
 * A passcode: eight digits in the rules' sense, ten to be safe.
 *
 * The column is a `bigint`, so the ceiling is far higher than `integer`'s — but
 * “far higher” is still a ceiling, and a passcode is a card's identity, not an
 * arbitrary number. Ten digits is what `media-routes` already accepts in its
 * file names; the two now agree instead of each having an opinion.
 */
const PASSCODE_MAX = 9_999_999_999;

export function requirePasscode(raw: string | undefined): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > PASSCODE_MAX) {
    throw invalidInput("Invalid passcode.");
  }
  return value;
}
