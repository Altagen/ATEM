/**
 * L'état de session, partagé par les écrans.
 *
 * Une seule requête en vol à la fois : sans ce dédoublonnage, trois composants
 * qui s'affichent ensemble demandent trois fois le même profil au démarrage.
 */
import { api, ApiError, type PublicUser } from "./api.js";
import { setLocale } from "./i18n/index.js";

let current: PublicUser | null = null;
let inFlight: Promise<PublicUser | null> | null = null;

export function knownUser(): PublicUser | null {
  return current;
}

export function setUser(user: PublicUser | null): void {
  current = user;
  inFlight = null;
  /**
   * La langue suit le compte, pas le navigateur.
   *
   * C'est un réglage qu'on choisit une fois et qu'on retrouve sur son
   * téléphone comme sur son ordinateur. Sans compte, on repart du français —
   * les écrans de connexion n'ont pas encore de qui les lire.
   */
  setLocale(user?.locale ?? "fr");
}

export async function loadUser(): Promise<PublicUser | null> {
  if (current) return current;
  inFlight ??= api<{ user: PublicUser }>("/auth/me")
    .then(({ user }) => {
      current = user;
      setLocale(user.locale);
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
