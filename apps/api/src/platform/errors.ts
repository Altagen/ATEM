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
