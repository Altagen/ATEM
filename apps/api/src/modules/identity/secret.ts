/**
 * The token signing key — read once, with no fallback value.
 *
 * The earlier prototype had a hard-coded fallback written in three places. An instance
 * deployed without `JWT_SECRET` therefore accepted tokens forged by anyone who
 * had read the repository. The constant's name announced the danger without
 * preventing it: a safeguard that relies on vigilance is not one.
 *
 * The minimum length closes the door next to it — an eight-character key
 * satisfies “the variable exists” while staying guessable.
 */
const MIN_LENGTH = 32;

/** the earlier prototype's old fallback. Refusing it by name keeps it from coming back by copy. */
const HISTORICAL_FALLBACK = "atem_dev_secret_key_change_me_in_prod";

let cached: string | null = null;

export function requireJwtSecret(): string {
  if (cached) return cached;
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error(
      "JWT_SECRET is required. Generate one: openssl rand -base64 32",
    );
  }
  if (secret === HISTORICAL_FALLBACK) {
    throw new Error(
      "JWT_SECRET holds the old fallback value, published in a repository. " +
        "Generate another one: openssl rand -base64 32",
    );
  }
  if (secret.length < MIN_LENGTH) {
    throw new Error(
      `JWT_SECRET is ${secret.length} characters, ${MIN_LENGTH} minimum. ` +
        "Generate one: openssl rand -base64 32",
    );
  }

  cached = secret;
  return cached;
}

/** Tests: the key is read again on the next call. */
export function resetJwtSecretCache(): void {
  cached = null;
}
