/**
 * The API client.
 *
 * One function knows how to talk to the server: the day authentication, error
 * handling or the prefix change, they change here.
 */
import type { Avatar } from "@atem/shared";
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

/**
 * `body` is sent as JSON; `text` as it is.
 *
 * `text` exists for the collection import, which takes the file as the raw body:
 * wrapping a CSV in JSON would escape every quote and line break for nothing.
 * Going through here rather than a second `fetch` keeps one place that reads the
 * server's errors.
 */
type Options = {
  method?: string;
  body?: unknown;
  text?: { content: string; contentType: string };
  signal?: AbortSignal;
};

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: options.method ?? "GET",
    headers: options.text
      ? { "Content-Type": options.text.contentType }
      : options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.text ? options.text.content : options.body ? JSON.stringify(options.body) : undefined,
    // The token travels in an `httpOnly` cookie: no script can read it, so no
    // script can leak it.
    credentials: "same-origin",
    signal: options.signal ?? null,
  });

  if (response.status === 204) return undefined as T;

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // A response with no readable body is still a response: we keep the status.
  }

  if (!response.ok) {
    const body = (payload ?? {}) as { error?: string; message?: string };
    /**
     * The server's message goes through the dictionary.
     *
     * The API answers in English — its sentence **is** the key. Rather than
     * inventing a distinct error code for each of its thirty sentences, the
     * front looks the sentence itself up, exactly as everywhere else. An
     * unknown sentence comes out as is: a message we failed to translate beats
     * a generic one that teaches nothing.
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
  avatar: Avatar;
  createdAt: string;
};

export type CardDetail = {
  passcode: number;
  name: string;
  desc: string | null;
  /** True when the card is not translated in the catalogue yet. */
  frenchPending: boolean;
  type: string | null;
  /** The frame — `fusion`, `synchro`, `xyz`, `link`… It decides the Extra Deck. */
  frameType: string | null;
  race: string | null;
  attribute: string | null;
  atk: number | null;
  def: number | null;
  level: number | null;
  linkValue: number | null;
  linkMarkers: string[] | null;
  archetype: string | null;
  /** The banlist status, as the catalogue writes it. */
  banlistTcg: string | null;
  imageUrl: string | null;
  imageUrlSmall: string | null;
};
