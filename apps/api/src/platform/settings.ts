/**
 * The tunable settings, read from the environment.
 *
 * **A setting that cannot be read falls back to its default, loudly.** ATEM
 * 0.1.0 did `Number(process.env.ATEM_DB_POOL ?? 10)`: under podman-compose,
 * which does not expand `${ATEM_DB_POOL:-10}` and passes that text through
 * verbatim, the pool size became `NaN` and the API died at startup with
 * `RangeError: Invalid array length` — a stack trace from inside a driver,
 * naming nothing an operator could act on (found on a Debian instance,
 * 2026-09-23).
 *
 * The rule here: an unusable value never crashes the server and never passes
 * silently. It is replaced by the documented default and said on the way.
 */

/** Settings whose value was not usable, in the order they were read. */
const fallbacks: string[] = [];

/**
 * A positive whole number, or the default.
 *
 * `min` guards the settings where zero is not a working value — a connection
 * pool of zero opens no connection at all.
 */
export function envInt(name: string, fallback: number, min = 1): number {
  const raw = (process.env[name] ?? "").trim();
  if (raw === "") return fallback;

  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < min) {
    fallbacks.push(`${name}=“${raw}” is not a whole number ≥ ${min}, using ${fallback}`);
    return fallback;
  }
  return value;
}

/** Same, for a size in bytes: zero is a legitimate reserve. */
export const envBytes = (name: string, fallback: number): number => envInt(name, fallback, 0);

/**
 * What was rejected, for the startup summary — and emptied as it is read, so a
 * test can exercise the reporting without leaking into the next one.
 */
export function takeFallbacks(): string[] {
  return fallbacks.splice(0, fallbacks.length);
}
