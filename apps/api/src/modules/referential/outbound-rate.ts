/**
 * Le débit sortant vers YGOPRODeck — un seul seau à jetons pour tout.
 *
 * La limite annoncée est de 20 requêtes par seconde, et la dépasser vaut un
 * blocage d'adresse d'une heure. ATEM-old a vécu ce blocage : il limitait les
 * appels d'API, mais **pas** les téléchargements d'images, qui partaient par un
 * autre chemin sans être comptés. Un limiteur par type d'appel ne protège de
 * rien — c'est le total qui compte, et `scripts/check-outbound.mjs` refuse
 * désormais tout `fetch` qui ne passerait pas par ici.
 *
 * On reste volontairement sous la limite annoncée : rien ne presse, et la marge
 * absorbe les imprécisions d'horloge.
 */
const MAX_PER_SECOND = 8;
const INTERVAL_MS = 1000 / MAX_PER_SECOND;

/** Le plafond de mise au pas, quoi que demande le serveur d'en face. */
const MAX_BACKOFF_MS = 10 * 60_000;

let nextSlot = 0;

export async function withOutboundSlot<T>(task: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + INTERVAL_MS;

  const wait = slot - now;
  if (wait > 0) {
    await new Promise<void>((resolve) => {
      // Délibérément pas de `unref()` : un script en ligne de commande se
      // terminerait avant la fin de son étalement, et partirait sans avoir
      // fait le travail. Ça paraît sale, ça ne l'est pas.
      setTimeout(resolve, wait);
    });
  }
  return task();
}

/**
 * Met tout le seau au pas après un refus pour excès de débit.
 *
 * Un 429 ne concerne pas la requête qui l'a reçu : il dit que **l'instance**
 * parle trop. Réessayer cet appel-là plus tard pendant que cent autres partent
 * à plein débit, c'est se faire bloquer l'adresse pour de bon — et le blocage
 * dure une heure, pendant laquelle plus aucune carte ne s'identifie.
 *
 * On décale donc le prochain jeton pour **tous** les appelants, sans jamais
 * raccourcir une mise au pas déjà en cours.
 */
export function throttleOutbound(delayMs: number): void {
  if (!Number.isFinite(delayMs) || delayMs <= 0) return;
  const until = Date.now() + Math.min(delayMs, MAX_BACKOFF_MS);
  if (until > nextSlot) nextSlot = until;
}

/**
 * Lit `Retry-After`, dans ses deux formes.
 *
 * L'en-tête porte soit un nombre de secondes, soit une date HTTP. Les deux
 * existent dans la nature ; n'en lire qu'une revient à ignorer l'autre en
 * silence et à repartir aussitôt.
 */
export function retryAfterMs(header: string | null | undefined): number | null {
  if (!header) return null;
  const trimmed = header.trim();

  const seconds = Number(trimmed);
  if (Number.isFinite(seconds)) return seconds > 0 ? seconds * 1000 : 0;

  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - Date.now());
}

/** Tests : repart d'un seau vide. */
export function resetOutboundRate(): void {
  nextSlot = 0;
}
