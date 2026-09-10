/**
 * Le débit sortant vers YGOPRODeck — un seul seau à jetons pour tout.
 *
 * La limite annoncée est de 20 requêtes par seconde, et la dépasser vaut un
 * blocage d'adresse d'une heure. ATEM-old a vécu ce blocage : il limitait les
 * appels d'API, mais **pas** les téléchargements d'images, qui partaient par un
 * autre chemin sans être comptés. Un limiteur par type d'appel ne protège de
 * rien — c'est le total qui compte.
 *
 * On reste volontairement sous la limite annoncée : rien ne presse, et la marge
 * absorbe les imprécisions d'horloge.
 */
const MAX_PER_SECOND = 8;
const INTERVAL_MS = 1000 / MAX_PER_SECOND;

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

/** Tests : repart d'un seau vide. */
export function resetOutboundRate(): void {
  nextSlot = 0;
}
