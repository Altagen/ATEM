/**
 * Les erreurs que les routes savent traduire en réponse HTTP.
 *
 * Un service ne connaît pas le HTTP : il lève une erreur qui décrit *ce qui ne va
 * pas*, et la couche route décide du code. ATEM-old comparait des chaînes
 * (`msg === "folder_max_depth"`) — un renommage silencieux cassait la réponse.
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

export const notFound = (m = "Ressource introuvable") => new AppError("not_found", m);
export const conflict = (m: string, d?: Record<string, unknown>) => new AppError("conflict", m, d);
export const invalidInput = (m: string, d?: Record<string, unknown>) =>
  new AppError("invalid_input", m, d);
export const unauthorized = (m = "Authentification requise") => new AppError("unauthorized", m);
export const forbidden = (m = "Accès refusé") => new AppError("forbidden", m);
