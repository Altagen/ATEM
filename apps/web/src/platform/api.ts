/**
 * Le client d'API.
 *
 * Une seule fonction sait parler au serveur : le jour où l'authentification, la
 * gestion d'erreur ou le préfixe changent, ils changent ici.
 */
import { t, tServer } from "./i18n/index.js";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Options = { method?: string; body?: unknown; signal?: AbortSignal };

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: options.method ?? "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
    // Le jeton voyage dans un cookie `httpOnly` : aucun script ne peut le lire,
    // donc aucun script ne peut le fuiter.
    credentials: "same-origin",
    signal: options.signal ?? null,
  });

  if (response.status === 204) return undefined as T;

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // Une réponse sans corps lisible reste une réponse : on garde le statut.
  }

  if (!response.ok) {
    const body = (payload ?? {}) as { error?: string; message?: string };
    /**
     * Le message du serveur passe par le dictionnaire.
     *
     * L'API répond en français. Plutôt que d'inventer un code d'erreur distinct
     * pour chacune de ses trente phrases, le front cherche la phrase elle-même
     * — c'est la même clé que partout ailleurs. Une phrase inconnue ressort
     * telle quelle : un message qu'on n'a pas su traduire vaut mieux qu'un
     * message générique qui n'apprend rien.
     */
    throw new ApiError(
      response.status,
      body.error ?? "unknown",
      body.message
        ? tServer(body.message)
        : t("The server replied {status}.", { status: response.status }),
    );
  }
  return payload as T;
}

export type PublicUser = {
  id: string;
  displayName: string;
  tag: string;
  locale: "fr" | "en";
  role: string;
  createdAt: string;
};

export type CardDetail = {
  passcode: number;
  name: string;
  desc: string | null;
  /** Vrai quand la carte n'est pas encore traduite dans le catalogue. */
  frenchPending: boolean;
  type: string | null;
  /** Le cadre — `fusion`, `synchro`, `xyz`, `link`… Il décide de l'Extra Deck. */
  frameType: string | null;
  race: string | null;
  attribute: string | null;
  atk: number | null;
  def: number | null;
  level: number | null;
  linkValue: number | null;
  linkMarkers: string[] | null;
  archetype: string | null;
  /** Le statut de banlist, tel que le catalogue l'écrit. */
  banlistTcg: string | null;
  imageUrl: string | null;
  imageUrlSmall: string | null;
};
