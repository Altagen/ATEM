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
