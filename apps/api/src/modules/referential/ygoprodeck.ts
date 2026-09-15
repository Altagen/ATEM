/**
 * The YGOPRODeck client.
 *
 * Two lessons learned the hard way, written down here:
 *
 * — **Zod silently drops the fields it does not declare.** `linkval` and
 *   `linkmarkers` were missing from ATEM-old's schema, and every Link card
 *   displayed “Link —”. The field existed, the value never arrived. Any
 *   addition here must be tested against a real payload, never against an
 *   object rebuilt by hand.
 *
 * — **The API answers 400 with an `{error}` body when it finds nothing.** That
 *   is not an outage, it is an absence: it must be read, not propagated.
 */
import { z } from "zod";
import { retryAfterMs, throttleOutbound, withOutboundSlot } from "./outbound-rate.js";

const BASE = "https://db.ygoprodeck.com/api/v7";

/**
 * The delay after which we stop waiting.
 *
 * `fetch` without a signal **never** gives up. The resolve queue waits on its
 * call, its lock stays taken, and a single hanging call is enough to freeze all
 * identification until the process restarts. The full dump is the long case —
 * 22 s measured, 21 MB — hence two distinct budgets rather than a single one
 * generous to everybody.
 */
const TIMEOUT_MS = 15_000;
const DUMP_TIMEOUT_MS = 120_000;

const CardSetSchema = z.object({
  set_name: z.string().nullish(),
  set_code: z.string(),
  set_rarity: z.string().nullish(),
  set_rarity_code: z.string().nullish(),
});

const CardImageSchema = z.object({
  id: z.number(),
  image_url: z.string().nullish(),
  image_url_small: z.string().nullish(),
});

const YgoCardSchema = z.object({
  id: z.number(),
  name: z.string(),
  type: z.string().nullish(),
  frameType: z.string().nullish(),
  desc: z.string().nullish(),
  atk: z.number().nullish(),
  def: z.number().nullish(),
  level: z.number().nullish(),
  race: z.string().nullish(),
  // Measured on the full dump: one card in 14,524 has `attribute: null`. A
  // missing field and a null field are two different things to Zod; the API
  // produces both, `.nullish()` accepts both.
  attribute: z.string().nullish(),
  scale: z.number().nullish(),
  linkval: z.number().nullish(),
  linkmarkers: z.array(z.string()).nullish(),
  archetype: z.string().nullish(),
  banlist_info: z.object({ ban_tcg: z.string().nullish() }).nullish(),
  card_sets: z.array(CardSetSchema).nullish(),
  card_images: z.array(CardImageSchema).nullish(),
});

export type YgoCard = z.infer<typeof YgoCardSchema>;

const SetInfoSchema = z.object({
  id: z.number(),
  name: z.string(),
  set_name: z.string().nullish(),
  set_code: z.string(),
  set_rarity: z.string().nullish(),
});

export type YgoSetInfo = z.infer<typeof SetInfoSchema>;

async function getJson(url: string, timeoutMs = TIMEOUT_MS): Promise<unknown | null> {
  const response = await withOutboundSlot(() =>
    fetch(url, { redirect: "follow", signal: AbortSignal.timeout(timeoutMs) }),
  );
  if (response.status === 400) {
    // “No card matching your query”: an absence, not an outage.
    return null;
  }
  /**
   * A 429 backs off the **whole** bucket, not just this call.
   *
   * The server is not saying “this request is one too many”, it is saying “you
   * are talking too much”. Carrying on at full rate while retrying this one
   * earns the one-hour address ban, during which nothing gets identified at
   * all.
   */
  if (response.status === 429) {
    const delay = retryAfterMs(response.headers.get("Retry-After")) ?? 60_000;
    throttleOutbound(delay);
    throw new Error(`YGOPRODeck is rate limiting (429), pausing ${Math.round(delay / 1000)} s`);
  }
  if (!response.ok) {
    throw new Error(`YGOPRODeck answered ${response.status} on ${url}`);
  }
  const body: unknown = await response.json();
  if (body && typeof body === "object" && "error" in body) return null;
  return body;
}

/** Resolves an **English** set code. Other regions are not indexed. */
export async function fetchSetInfo(englishSetCode: string): Promise<YgoSetInfo | null> {
  const body = await getJson(
    `${BASE}/cardsetsinfo.php?setcode=${encodeURIComponent(englishSetCode)}`,
  );
  if (!body) return null;
  const parsed = SetInfoSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
}

export async function fetchCardById(
  passcode: number,
  language?: "fr",
): Promise<YgoCard | null> {
  const lang = language ? `&language=${language}` : "";
  const body = await getJson(`${BASE}/cardinfo.php?id=${passcode}${lang}`);
  if (!body) return null;
  const parsed = z.object({ data: z.array(YgoCardSchema).min(1) }).safeParse(body);
  return parsed.success ? (parsed.data.data[0] ?? null) : null;
}

/**
 * The full dump, in a single request.
 *
 * Measured on 2026-09-09: 14,524 cards and 21 MB in English (22 s), 11,661
 * cards and 18 MB in French. 2,863 cards have no French version at all — the
 * English fallback is not an edge case, it is a fifth of the catalogue.
 */
export async function fetchAllCards(language?: "fr"): Promise<YgoCard[]> {
  const lang = language ? `?language=${language}` : "";
  const body = await getJson(`${BASE}/cardinfo.php${lang}`, DUMP_TIMEOUT_MS);
  if (!body) return [];
  const parsed = z.object({ data: z.array(YgoCardSchema) }).safeParse(body);
  if (!parsed.success) {
    throw new Error(`Unreadable YGOPRODeck dump: ${parsed.error.issues[0]?.message ?? "?"}`);
  }
  return parsed.data.data;
}
