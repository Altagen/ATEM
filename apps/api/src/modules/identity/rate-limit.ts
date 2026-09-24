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
import { envInt } from "../../platform/settings.js";
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
/**
 * Read at each call, not once at import: a table frozen on the first import
 * ignores an instance that changed its ceilings, and leaves the tests unable to
 * exercise the limit at all — which is how it went untested until 2026-09-16.
 */
const limitFor = (action: string): LimitRule | null => {
  if (action === "login") {
    return { max: envInt("ATEM_LOGIN_ATTEMPTS_MAX", 10), windowMs: 15 * 60 * 1000 };
  }
  if (action === "register") {
    return { max: envInt("ATEM_REGISTER_ATTEMPTS_MAX", 5), windowMs: 60 * 60 * 1000 };
  }
  return null;
};

export async function enforceRateLimit(
  db: Database,
  action: string,
  buckets: string[],
): Promise<void> {
  const rule = limitFor(action);
  if (rule) await enforceLimit(db, action, buckets, rule);
}

/** The ceiling itself, with the rule spelled out — what the tests measure. */
export async function enforceLimit(
  db: Database,
  action: string,
  buckets: string[],
  rule: LimitRule,
): Promise<void> {
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
