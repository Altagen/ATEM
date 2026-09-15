/**
 * Limiting authentication attempts.
 *
 * Two counters, not one: the calling address **and** the targeted account.
 * Counting the address alone lets a network of machines try one password per
 * machine; counting the account alone lets one address sweep accounts one by
 * one. Together they close both doors.
 */
import { and, eq, gte, sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { AppError } from "../../platform/errors.js";
import { authAttempts } from "./schema.js";

export type LimitRule = { max: number; windowMs: number };

/**
 * The ceilings, tunable per instance.
 *
 * A shop registering twenty players on tournament night, from the same network,
 * would otherwise hit a limit designed for home use — and the organiser would
 * have no way to loosen it. The defaults stay strict; configuration exists for
 * the real cases.
 */
const envInt = (name: string, fallback: number): number => {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
};

const AUTH_LIMITS: Record<string, LimitRule> = {
  login: { max: envInt("ATEM_LOGIN_ATTEMPTS_MAX", 10), windowMs: 15 * 60 * 1000 },
  register: { max: envInt("ATEM_REGISTER_ATTEMPTS_MAX", 5), windowMs: 60 * 60 * 1000 },
};

export async function enforceRateLimit(
  db: Database,
  action: keyof typeof AUTH_LIMITS,
  buckets: string[],
): Promise<void> {
  const rule = AUTH_LIMITS[action];
  if (!rule) return;
  const since = new Date(Date.now() - rule.windowMs);

  for (const bucket of buckets) {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(authAttempts)
      .where(
        and(
          eq(authAttempts.bucket, bucket),
          eq(authAttempts.action, action),
          gte(authAttempts.attemptedAt, since),
        ),
      );
    if ((row?.count ?? 0) >= rule.max) {
      throw new AppError("rate_limited", "Too many attempts, try again later.");
    }
  }
}

export async function recordAttempt(
  db: Database,
  action: string,
  buckets: string[],
): Promise<void> {
  if (buckets.length === 0) return;
  await db.insert(authAttempts).values(buckets.map((bucket) => ({ bucket, action })));
}

/**
 * The attempts of an account that just succeeded have no reason to count
 * against it any more: otherwise ten legitimate sign-ins in fifteen minutes
 * lock out a normal user.
 */
export async function clearAttempts(
  db: Database,
  action: string,
  buckets: string[],
): Promise<void> {
  for (const bucket of buckets) {
    await db
      .delete(authAttempts)
      .where(and(eq(authAttempts.bucket, bucket), eq(authAttempts.action, action)));
  }
}
