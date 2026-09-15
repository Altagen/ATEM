/**
 * Deferred resolution of printings.
 *
 * A scanned card enters the inventory immediately, as `pending`. It is this
 * queue that then asks YGOPRODeck what it is.
 *
 * **De-duplication is by (user, code), not by code alone.** ATEM-old lived the
 * bug: if A had already queued `LOB-FR001`, B's entry was dropped as a
 * duplicate — and B's line stayed provisional indefinitely. The work to do is
 * not “resolve this code”, it is “repair this person's line”.
 */
type Attempt = (userId: string, setCode: string) => Promise<boolean>;

/**
 * What we do with a code we know does not exist.
 *
 * An absence is **final**: the code is not at YGOPRODeck, and asking again
 * tomorrow will not put it there. Without this signal the line stayed
 * `pending` — indistinguishable from an interrupted resolution — and every
 * restart queued it again. On a collection holding a few of those, that is a
 * burst of useless calls at every startup, towards the very API we take care
 * not to saturate.
 */
type Abandon = (userId: string, setCode: string) => Promise<void>;

type Entry = { userId: string; setCode: string; attempts: number; readyAt: number };

const MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 2_000;

const queue = new Map<string, Entry>();
let running = false;
let attemptFn: Attempt | null = null;
let abandonFn: Abandon | null = null;
let timer: NodeJS.Timeout | null = null;

/**
 * The key separator.
 *
 * A vertical bar can appear neither in a UUID nor in a normalised set code —
 * whose alphabet is limited to letters, digits and the dash. Two distinct keys
 * therefore cannot be confused.
 */
const keyOf = (userId: string, setCode: string) => `${userId}|${setCode}`;

export function configureResolveQueue(handlers: {
  attempt: Attempt;
  abandon: Abandon;
}): void {
  attemptFn = handlers.attempt;
  abandonFn = handlers.abandon;
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
  // This timer does not hold back a process that wants to stop: no work is
  // lost, the line stays `pending` and is picked up at the next startup.
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
        if (resolved) continue;
        /**
         * A failure **without an error** is an absence, not an outage: this
         * code does not exist at YGOPRODeck. Retrying will not make it appear,
         * so we record it so that nobody asks again — neither this queue nor
         * the next startup's catch-up.
         */
        await abandonFn?.(entry.userId, entry.setCode);
      } catch (err) {
        const next = entry.attempts + 1;
        if (next < MAX_ATTEMPTS) {
          // Growing wait, with a random share: without it, a hundred lines
          // queued together would all set off on the same second.
          const delay = BASE_DELAY_MS * 2 ** next * (0.5 + Math.random());
          queue.set(key, { ...entry, attempts: next, readyAt: Date.now() + delay });
        } else {
          /**
           * Four outages in a row: we let go for this time, **without** marking
           * the code absent. The difference matters — a network outage is not a
           * non-existent card, and the line must be queued again at the next
           * startup.
           */
          console.warn(`[atem] resolution abandoned for ${entry.setCode}:`, err);
        }
      }
    }
  } finally {
    running = false;
    if (queue.size > 0) schedule(BASE_DELAY_MS);
  }
}

/** Tests: empties the queue. */
export function resetResolveQueue(): void {
  queue.clear();
  if (timer) clearTimeout(timer);
  timer = null;
  running = false;
}

export function pendingCount(): number {
  return queue.size;
}

/** Tests: drains the queue right away, without waiting for the timer. */
export async function drainNow(): Promise<void> {
  await drain();
}
