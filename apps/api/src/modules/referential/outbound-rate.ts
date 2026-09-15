/**
 * Outbound rate towards YGOPRODeck — a single token bucket for everything.
 *
 * The announced limit is 20 requests per second, and going past it earns a
 * one-hour address ban. ATEM-old lived that ban: it limited API calls but
 * **not** image downloads, which went out by another path without being
 * counted. A limiter per kind of call protects nothing — the total is what
 * counts, and `scripts/check-outbound.mjs` now refuses any `fetch` that would
 * not go through here.
 *
 * We deliberately stay under the announced limit: nothing is urgent, and the
 * margin absorbs clock imprecision.
 */
const MAX_PER_SECOND = 8;
const INTERVAL_MS = 1000 / MAX_PER_SECOND;

/** The back-off ceiling, whatever the far server asks for. */
const MAX_BACKOFF_MS = 10 * 60_000;

let nextSlot = 0;

export async function withOutboundSlot<T>(task: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + INTERVAL_MS;

  const wait = slot - now;
  if (wait > 0) {
    await new Promise<void>((resolve) => {
      // Deliberately no `unref()`: a command-line script would end before its
      // spreading is over, and would leave without having done the work. It
      // looks unclean; it is not.
      setTimeout(resolve, wait);
    });
  }
  return task();
}

/**
 * Backs the whole bucket off after a rate refusal.
 *
 * A 429 is not about the request that received it: it says the **instance** is
 * talking too much. Retrying that one call later while a hundred others go out
 * at full rate is how the address gets banned for good — and the ban lasts an
 * hour, during which no card gets identified at all.
 *
 * So we push the next slot back for **every** caller, never shortening a
 * back-off already under way.
 */
export function throttleOutbound(delayMs: number): void {
  if (!Number.isFinite(delayMs) || delayMs <= 0) return;
  const until = Date.now() + Math.min(delayMs, MAX_BACKOFF_MS);
  if (until > nextSlot) nextSlot = until;
}

/**
 * Reads `Retry-After`, in both of its shapes.
 *
 * The header carries either a number of seconds or an HTTP date. Both exist in
 * the wild; reading only one amounts to ignoring the other in silence and
 * setting off again immediately.
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

/** Tests: start again from an empty bucket. */
export function resetOutboundRate(): void {
  nextSlot = 0;
}
