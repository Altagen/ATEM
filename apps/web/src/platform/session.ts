/**
 * The session state, shared by the screens.
 *
 * One request in flight at a time: without that de-duplication, three
 * components rendering together ask for the same profile three times at
 * startup.
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
   * The language follows the account, not the browser.
   *
   * It is a setting you choose once and find again on your phone as on your
   * computer. With no account we fall back to French — the sign-in screens do
   * not know yet who is reading them.
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
      // A 401 is not a failure: it is the normal answer to “who am I?” when
      // nobody is signed in.
      if (err instanceof ApiError && err.status === 401) return null;
      throw err;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}
