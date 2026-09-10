/**
 * En-têtes de sécurité et garde CSRF.
 *
 * La garde d'origine complète `SameSite=Strict` : elle ne s'applique qu'aux
 * écritures, et seulement quand l'authentification passe par cookie. Un
 * `Authorization: Bearer` ne peut pas être joint involontairement par un
 * navigateur — l'exiger là serait du bruit sans gain.
 */
import type { MiddlewareHandler } from "hono";
import { forbidden } from "./errors.js";

export const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "same-origin");
  c.header("X-Frame-Options", "DENY");
  c.header("Cross-Origin-Opener-Policy", "same-origin");
};

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * La garde compare les **hôtes**, pas les origines entières.
 *
 * Le protocole ne peut pas entrer dans la comparaison : dès qu'une terminaison
 * TLS se trouve devant — nginx en production, le serveur de développement en
 * HTTPS — l'API reçoit du clair et calcule `http://…`, pendant que le
 * navigateur annonce `https://…`. Les deux ne coïncident jamais, et **toute
 * écriture est refusée** : ajouter une carte, se déconnecter, changer un
 * réglage. Le symptôme est un 403 opaque, et la connexion, elle, passe — le
 * garde se tait tant qu'il n'y a pas de cookie.
 *
 * Ce n'est pas une concession : ce qui protège ici, c'est que l'hôte de la page
 * soit le nôtre, doublé d'un cookie `SameSite=Strict`. Un `http://` et un
 * `https://` sur le même hôte ne sont pas deux sites différents pour la
 * question qui nous occupe.
 *
 * Faire confiance à `X-Forwarded-Proto` était l'autre voie ; elle demande de
 * savoir quels mandataires sont dignes de foi, faute de quoi n'importe qui
 * fabrique l'en-tête. Comparer l'hôte ne demande rien.
 */
export const csrfGuard: MiddlewareHandler = async (c, next) => {
  if (!WRITE_METHODS.has(c.req.method)) return next();
  // Jeton porté explicitement : le navigateur ne l'ajoute jamais tout seul.
  if (c.req.header("Authorization")?.startsWith("Bearer ")) return next();

  const origin = c.req.header("Origin");
  if (!origin) return next();

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw forbidden("Origine illisible.");
  }

  // `Host` tel que le mandataire l'a transmis ; à défaut, celui de la requête.
  const expectedHost = c.req.header("Host") ?? new URL(c.req.url).host;
  if (originHost !== expectedHost) {
    throw forbidden("Origine non autorisée.");
  }
  await next();
};

/** Une requête sans corps borné peut saturer la mémoire du serveur. */
export function bodyLimit(maxBytes: number): MiddlewareHandler {
  return async (c, next) => {
    const declared = Number(c.req.header("Content-Length") ?? 0);
    if (declared > maxBytes) {
      return c.json({ error: "payload_too_large" }, 413);
    }
    await next();
  };
}
