/**
 * Password hashing. Ported from ATEM-old, where it was already mature.
 *
 * **The format carries its parameters.** A hash written `salt:hash` does not
 * say at what cost it was produced: raising that cost — which has to happen
 * over the years — would invalidate every existing password. The
 * `scrypt$N$r$p$salt$hash` format makes it possible to raise it without
 * breaking anything, and the old shape is still read.
 *
 * **Hashing is asynchronous.** `scryptSync` blocks the event loop for its
 * hundred-odd milliseconds: that is a denial of service inflicted on oneself,
 * and it gets worse precisely when the cost is raised.
 *
 * **The cost.** `N = 2^16` asks 64 MB per concurrent hash. The current
 * recommendation is `2^17`, i.e. 128 MB — which a small instance cannot hold if
 * thirty people sign in at once. The factor of four is taken, the margin is
 * noted, and the format allows raising it when the day comes.
 */
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const CURRENT_PARAMS = { N: 65536, r: 8, p: 1 } as const;

const KEY_LENGTH = 64;

/** `scrypt` refuses to work unless `maxmem` exceeds `128 · N · r`. */
const memoryFor = (N: number, r: number) => Math.max(64, 128 * N * r * 2);

type Params = { N: number; r: number; p: number };

/** A `salt:hash` hash comes from `scryptSync(password, salt, 64)`, default cost. */
const LEGACY_PARAMS: Params = { N: 16384, r: 8, p: 1 };

function parse(stored: string): { params: Params; salt: string; hash: string } | null {
  if (stored.startsWith("scrypt$")) {
    const [, N, r, p, salt, hash] = stored.split("$");
    if (!N || !r || !p || !salt || !hash) return null;
    const params = { N: Number(N), r: Number(r), p: Number(p) };
    if (!Number.isFinite(params.N) || !Number.isFinite(params.r) || !Number.isFinite(params.p)) {
      return null;
    }
    return { params, salt, hash };
  }
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return null;
  return { params: LEGACY_PARAMS, salt, hash };
}

export async function hashPassword(password: string): Promise<string> {
  const { N, r, p } = CURRENT_PARAMS;
  const salt = randomBytes(16).toString("hex");
  const derived = await scryptAsync(password, salt, KEY_LENGTH, {
    N, r, p, maxmem: memoryFor(N, r),
  });
  return `scrypt$${N}$${r}$${p}$${salt}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const read = parse(stored);
  if (!read) return false;
  const { N, r, p } = read.params;

  let derived: Buffer;
  try {
    derived = await scryptAsync(password, read.salt, KEY_LENGTH, {
      N, r, p, maxmem: memoryFor(N, r),
    });
  } catch {
    // Impossible parameters in a damaged hash: we refuse, without throwing.
    return false;
  }

  const expected = Buffer.from(read.hash, "hex");
  // `timingSafeEqual` requires two buffers of the same length: a truncated hash
  // would throw rather than refuse.
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(expected, derived);
}

/**
 * Does this hash deserve to be recomputed?
 *
 * Recomputing needs the password in the clear: that can only happen at sign-in,
 * and that is exactly where the call is made.
 */
export function needsRehash(stored: string): boolean {
  const read = parse(stored);
  if (!read) return false;
  return (
    read.params.N < CURRENT_PARAMS.N ||
    read.params.r < CURRENT_PARAMS.r ||
    read.params.p < CURRENT_PARAMS.p
  );
}
