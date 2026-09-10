/**
 * La résolution différée des impressions.
 *
 * Une carte scannée entre dans l'inventaire immédiatement, en `pending`. C'est
 * cette file qui va ensuite demander à YGOPRODeck de quoi il s'agit.
 *
 * **Le dédoublonnage se fait par (utilisateur, code), pas par code seul.**
 * ATEM-old a vécu le bug : si A avait déjà mis `LOB-FR001` en file, l'entrée de
 * B était écartée comme un doublon — et la ligne de B restait provisoire
 * indéfiniment. Le travail à faire n'est pas « résoudre ce code », c'est
 * « réparer la ligne de cette personne ».
 */
type Attempt = (userId: string, setCode: string) => Promise<boolean>;

type Entry = { userId: string; setCode: string; attempts: number; readyAt: number };

const MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 2_000;

const queue = new Map<string, Entry>();
let running = false;
let attemptFn: Attempt | null = null;
let timer: NodeJS.Timeout | null = null;

/**
 * Le séparateur de clé.
 *
 * Une barre verticale ne peut apparaître ni dans un UUID ni dans un set code
 * normalisé — dont l'alphabet se limite aux lettres, aux chiffres et au tiret.
 * Deux clés distinctes ne peuvent donc pas se confondre.
 */
const keyOf = (userId: string, setCode: string) => `${userId}|${setCode}`;

export function configureResolveQueue(attempt: Attempt): void {
  attemptFn = attempt;
}

export function enqueueResolve(userId: string, setCode: string): void {
  const key = keyOf(userId, setCode);
  if (queue.has(key)) return;
  queue.set(key, { userId, setCode, attempts: 0, readyAt: Date.now() });
  schedule(0);
}

function schedule(delayMs: number): void {
  if (timer || running || queue.size === 0) return;
  timer = setTimeout(() => {
    timer = null;
    void drain();
  }, delayMs);
  // Ce minuteur ne retient pas un processus qui veut s'arrêter : aucun travail
  // n'est perdu, la ligne reste `pending` et sera reprise au démarrage suivant.
  timer.unref();
}

async function drain(): Promise<void> {
  if (running || !attemptFn) return;
  running = true;
  try {
    for (const [key, entry] of [...queue]) {
      if (entry.readyAt > Date.now()) continue;
      queue.delete(key);
      try {
        const resolved = await attemptFn(entry.userId, entry.setCode);
        // Un échec **sans erreur** est une absence, pas une panne : ce code
        // n'existe pas chez YGOPRODeck. Le réessayer ne le fera pas apparaître.
        if (resolved) continue;
      } catch (err) {
        const next = entry.attempts + 1;
        if (next < MAX_ATTEMPTS) {
          // Attente croissante, avec une part d'aléa : sans elle, cent lignes
          // mises en file ensemble repartiraient toutes à la même seconde.
          const delay = BASE_DELAY_MS * 2 ** next * (0.5 + Math.random());
          queue.set(key, { ...entry, attempts: next, readyAt: Date.now() + delay });
        } else {
          console.warn(`[atem] résolution abandonnée pour ${entry.setCode} :`, err);
        }
      }
    }
  } finally {
    running = false;
    if (queue.size > 0) schedule(BASE_DELAY_MS);
  }
}

/** Tests : vide la file. */
export function resetResolveQueue(): void {
  queue.clear();
  if (timer) clearTimeout(timer);
  timer = null;
  running = false;
}

export function pendingCount(): number {
  return queue.size;
}

/** Tests : traite la file tout de suite, sans attendre le minuteur. */
export async function drainNow(): Promise<void> {
  await drain();
}
