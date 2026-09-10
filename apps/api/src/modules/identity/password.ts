/**
 * Le hachage des mots de passe. Porté d'ATEM-old, où il était déjà mûr.
 *
 * **Le format porte ses paramètres.** Un hachage écrit `sel:hachage` ne dit pas
 * sous quel coût il a été produit : relever ce coût — ce qu'il faut faire au fil
 * des années — invaliderait tous les mots de passe existants. Le format
 * `scrypt$N$r$p$sel$hachage` permet de monter sans rien casser, et l'ancien
 * reste relu.
 *
 * **Le hachage est asynchrone.** `scryptSync` bloque la boucle d'événements
 * pendant sa centaine de millisecondes : c'est un déni de service qu'on
 * s'inflige, et il s'aggrave précisément quand on relève le coût.
 *
 * **Le coût.** `N = 2^16` demande 64 Mo par hachage simultané. La recommandation
 * courante est `2^17`, soit 128 Mo — ce qu'une petite instance ne tient pas si
 * trente personnes se connectent en même temps. Le facteur quatre est pris, la
 * marge est notée, et le format permet de monter le jour venu.
 */
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

export const CURRENT_PARAMS = { N: 65536, r: 8, p: 1 } as const;

const KEY_LENGTH = 64;

/** `scrypt` refuse de travailler si `maxmem` ne dépasse pas `128 · N · r`. */
const memoryFor = (N: number, r: number) => Math.max(64, 128 * N * r * 2);

type Params = { N: number; r: number; p: number };

/** Un hachage `sel:hachage` vient de `scryptSync(mdp, sel, 64)`, coût par défaut. */
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
    // Paramètres impossibles dans un hachage abîmé : on refuse, sans lever.
    return false;
  }

  const expected = Buffer.from(read.hash, "hex");
  // `timingSafeEqual` exige deux tampons de même longueur : un hachage tronqué
  // ferait lever plutôt que refuser.
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(expected, derived);
}

/**
 * Ce hachage mérite-t-il d'être refait ?
 *
 * Le refaire demande le mot de passe en clair : ça ne peut se produire qu'à la
 * connexion, et c'est exactement là que l'appel a lieu.
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
