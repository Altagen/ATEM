/**
 * The errors routes know how to turn into an HTTP response.
 *
 * A service knows nothing about HTTP: it throws an error describing *what is
 * wrong*, and the route layer decides the status. ATEM-old compared strings
 * (`msg === "folder_max_depth"`) — a silent rename broke the response.
 */
export type ErrorCode =
  | "not_found"
  | "conflict"
  | "invalid_input"
  | "unauthorized"
  | "forbidden"
  | "rate_limited"
  | "upstream_unavailable";

const HTTP_STATUS: Record<ErrorCode, number> = {
  not_found: 404,
  conflict: 409,
  invalid_input: 400,
  unauthorized: 401,
  forbidden: 403,
  rate_limited: 429,
  upstream_unavailable: 503,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }

  get status(): number {
    return HTTP_STATUS[this.code];
  }
}

export const notFound = (m = "Resource not found") => new AppError("not_found", m);
export const conflict = (m: string, d?: Record<string, unknown>) => new AppError("conflict", m, d);
export const invalidInput = (m: string, d?: Record<string, unknown>) =>
  new AppError("invalid_input", m, d);
export const unauthorized = (m = "Authentication required") => new AppError("unauthorized", m);
export const forbidden = (m = "Access denied") => new AppError("forbidden", m);

/**
 * Did this error come from a given database constraint?
 *
 * **Never search the message.** Drizzle wraps the driver's error: the outer
 * `message` carries the query that failed and never the constraint's name, so
 * `err.message.includes("…_uidx")` is false for a violation that did happen.
 * The identity module read it that way and its eight-attempt retry on a tag
 * collision had been dead since the wrapping was introduced — every collision
 * surfaced as a 500 instead. The deck module had already found the trap and
 * worked around it locally; this is that workaround, in one place, so a fourth
 * caller cannot get it wrong.
 *
 * The cause chain is walked rather than the first link read: a driver is free
 * to nest one more level, and a check that silently stops matching is exactly
 * the failure this replaces.
 */
export function violatesConstraint(error: unknown, constraint: string): boolean {
  let node: unknown = error;
  for (let depth = 0; node && depth < 5; depth += 1) {
    const candidate = node as { constraint_name?: string; cause?: unknown };
    if (candidate.constraint_name === constraint) return true;
    node = candidate.cause;
  }
  return false;
}

/**
 * What an error may say **in the log**.
 *
 * Logging the error object was writing password hashes to disk. Drizzle puts
 * the failed query *and its parameters* in the message, and the parameters are
 * the row being written — for a registration that is the scrypt hash, beside the
 * address it belongs to. Measured on 2026-09-16: `err.message` contained the
 * hash, and so did `String(err)`.
 *
 * A hash is not a password, but it is the material an offline attack needs, and
 * logs travel: they are rotated, shipped, read over a shoulder, pasted into an
 * issue. Nothing about a person's credentials belongs there.
 *
 * What stays is what an operator actually needs: the kind of error, the failed
 * statement, and the database's own code and constraint. The statement is
 * schema, which the repository already publishes; the parameters are data,
 * which it never will.
 */
export function loggableError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);

  // Everything from `params:` on is the row itself.
  const message = error.message.split(/\n\s*params:/)[0] ?? error.message;

  const cause = error.cause as
    | { code?: string; constraint_name?: string; detail?: string }
    | undefined;
  const from = [
    cause?.code && `code ${cause.code}`,
    cause?.constraint_name && `constraint ${cause.constraint_name}`,
  ]
    .filter(Boolean)
    .join(", ");

  // `detail` carries the offending values — “Key (email)=(a@b.c) already
  // exists” — so it is named, never quoted.
  const hasDetail = cause?.detail ? " (detail withheld)" : "";
  return `${error.name}: ${message}${from ? ` [${from}]` : ""}${hasDetail}`;
}
