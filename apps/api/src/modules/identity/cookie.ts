/**
 * Le transport du jeton.
 *
 * Le jeton lui-même est `httpOnly` : aucun script de la page ne peut le lire, ce
 * qui le met hors de portée d'une injection. Mais le front a besoin de savoir
 * s'il y a une session pour choisir quoi afficher — d'où un second cookie,
 * lisible et **sans valeur secrète**, qui ne dit que « oui, il y en a une ».
 */
import type { Context } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";

export const SESSION_COOKIE = "atem_session";
export const SESSION_HINT_COOKIE = "atem_signed_in";

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
  setCookie(c, SESSION_HINT_COOKIE, "1", {
    httpOnly: false,
    secure,
    sameSite: "Strict",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  deleteCookie(c, SESSION_HINT_COOKIE, { path: "/" });
}
