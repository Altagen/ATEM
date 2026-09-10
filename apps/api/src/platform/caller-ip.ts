/**
 * L'adresse de l'appelant, pour la limitation de débit.
 *
 * `X-Forwarded-For` est un en-tête que **le client peut écrire**. ATEM-old a
 * découvert en production que sa limitation était contournable en le forgeant :
 * une adresse différente à chaque requête, donc un compteur toujours à zéro.
 *
 * On ne lit donc cet en-tête que si l'instance déclare ses proxys de confiance
 * dans `ATEM_TRUSTED_PROXIES`. Sans cette déclaration, on prend l'adresse de la
 * connexion, quitte à compter tout le monde ensemble derrière un proxy — se
 * tromper dans le sens strict est le bon sens quand on doute.
 */
import type { MiddlewareHandler } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";

declare module "hono" {
  interface ContextVariableMap {
    callerIp: string;
  }
}

const trustedProxies = () =>
  (process.env.ATEM_TRUSTED_PROXIES ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

/**
 * L'adresse de la connexion, ou `unknown`.
 *
 * `getConnInfo` suppose l'adaptateur Node et lève sans lui — sous test, ou sous
 * un autre adaptateur. Une limitation de débit qui fait tomber le serveur quand
 * elle ne sait pas qui appelle est pire que le problème qu'elle traite : on
 * dégrade vers un seau commun, plus strict, jamais vers une panne.
 */
function connectionAddress(c: Parameters<MiddlewareHandler>[0]): string {
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

export const attachCallerIp: MiddlewareHandler = async (c, next) => {
  const direct = connectionAddress(c);
  const trusted = trustedProxies();

  if (trusted.length > 0 && trusted.includes(direct)) {
    const forwarded = c.req.header("X-Forwarded-For");
    const first = forwarded?.split(",")[0]?.trim();
    c.set("callerIp", first || direct);
  } else {
    c.set("callerIp", direct);
  }
  await next();
};
