/**
 * Le transport du jeton.
 *
 * Le jeton est `httpOnly` : aucun script de la page ne peut le lire, ce qui le
 * met hors de portée d'une injection.
 *
 * Il y avait ici un second cookie, lisible, censé dire au front qu'une session
 * existe. Personne ne l'a jamais lu — le front demande `/auth/me`, ce qui lui
 * rend l'identité en même temps que la réponse. Il partait donc à chaque
 * requête pour rien, avec un commentaire qui décrivait un rôle que rien ne
 * jouait.
 */
import type { Context } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";

export const SESSION_COOKIE = "atem_session";

/**
 * `Secure` est levé sur localhost uniquement : en développement, le navigateur
 * refuserait un cookie `Secure` servi en clair, et personne ne pourrait se
 * connecter.
 */
function isPlainLocalhost(c: Context): boolean {
  const host = new URL(c.req.url).hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

export function setSessionCookie(c: Context, token: string): void {
  const secure = !isPlainLocalhost(c);
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: "Strict",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}
