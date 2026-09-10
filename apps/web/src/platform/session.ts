/**
 * L'état de session, partagé par les écrans.
 *
 * Une seule requête en vol à la fois : sans ce dédoublonnage, trois composants
 * qui s'affichent ensemble demandent trois fois le même profil au démarrage.
 */
import { api, ApiError, type PublicUser } from "./api.js";

let current: PublicUser | null = null;
let inFlight: Promise<PublicUser | null> | null = null;

export function knownUser(): PublicUser | null {
  return current;
}

export function setUser(user: PublicUser | null): void {
  current = user;
  inFlight = null;
}

export async function loadUser(): Promise<PublicUser | null> {
  if (current) return current;
  inFlight ??= api<{ user: PublicUser }>("/auth/me")
    .then(({ user }) => {
      current = user;
      return user;
    })
    .catch((err) => {
      // 401 n'est pas une panne : c'est la réponse normale à « qui suis-je ? »
      // quand personne n'est connecté.
      if (err instanceof ApiError && err.status === 401) return null;
      throw err;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}
