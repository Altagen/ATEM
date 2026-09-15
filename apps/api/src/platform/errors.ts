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
