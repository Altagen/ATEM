/**
 * La limitation des tentatives d'authentification.
 *
 * Deux compteurs, pas un : l'adresse appelante **et** le compte visé. Compter la
 * seule adresse laisse un réseau de machines essayer un mot de passe par
 * machine ; compter le seul compte permet à une adresse de balayer les comptes
 * un par un. Les deux ensemble ferment les deux portes.
 */
import { and, eq, gte, sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { AppError } from "../../platform/errors.js";
import { authAttempts } from "./schema.js";

export type LimitRule = { max: number; windowMs: number };

/**
 * Les plafonds, réglables par l'instance.
 *
 * Une boutique qui inscrit vingt joueurs le soir d'un tournoi, depuis le même
 * réseau, se heurterait sinon à une limite pensée pour un usage domestique —
 * et l'organisateur n'aurait aucun moyen de la desserrer. Les valeurs par
 * défaut restent strictes ; la configuration existe pour les cas réels.
 */
const envInt = (name: string, fallback: number): number => {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
};

export const AUTH_LIMITS: Record<string, LimitRule> = {
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
      throw new AppError("rate_limited", "Trop de tentatives, réessayez plus tard.");
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
 * Les tentatives d'un compte qui vient de réussir n'ont plus de raison de
 * compter contre lui : sinon dix connexions légitimes en quinze minutes
 * verrouillent un utilisateur normal.
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
