/**
 * Le client YGOPRODeck.
 *
 * Deux points appris à la dure et inscrits ici :
 *
 * — **Zod retire silencieusement les champs qu'il ne déclare pas.** `linkval` et
 *   `linkmarkers` manquaient au schéma d'ATEM-old, et toutes les cartes Lien
 *   affichaient « Lien — ». Le champ existait, la valeur n'arrivait jamais. Tout
 *   ajout ici doit être testé contre une charge utile réelle, jamais contre un
 *   objet reconstruit à la main.
 *
 * — **L'API répond 400 avec un corps `{error}` quand elle ne trouve rien.** Ce
 *   n'est pas une panne, c'est une absence : il faut la lire, pas la propager.
 */
import { z } from "zod";
import { withOutboundSlot } from "./outbound-rate.js";

const BASE = "https://db.ygoprodeck.com/api/v7";

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

export const YgoCardSchema = z.object({
  id: z.number(),
  name: z.string(),
  type: z.string().nullish(),
  frameType: z.string().nullish(),
  desc: z.string().nullish(),
  atk: z.number().nullish(),
  def: z.number().nullish(),
  level: z.number().nullish(),
  race: z.string().nullish(),
  // Mesuré sur le dump complet : une carte sur 14 524 a `attribute: null`.
  // Un champ absent et un champ nul sont deux choses différentes pour Zod ;
  // l'API produit les deux, `.nullish()` accepte les deux.
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

async function getJson(url: string): Promise<unknown | null> {
  const response = await withOutboundSlot(() => fetch(url, { redirect: "follow" }));
  if (response.status === 400) {
    // « No card matching your query » : une absence, pas une panne.
    return null;
  }
  if (!response.ok) {
    throw new Error(`YGOPRODeck a répondu ${response.status} sur ${url}`);
  }
  const body: unknown = await response.json();
  if (body && typeof body === "object" && "error" in body) return null;
  return body;
}

/** Résout un set code **anglais**. Les autres régions ne sont pas indexées. */
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
 * Le dump complet, en une seule requête.
 *
 * Mesuré le 2026-09-09 : 14 524 cartes et 21 Mo en anglais (22 s), 11 661 cartes
 * et 18 Mo en français. 2 863 cartes n'ont aucune version française — le repli
 * anglais n'est pas un cas limite, c'est un cinquième du catalogue.
 */
export async function fetchAllCards(language?: "fr"): Promise<YgoCard[]> {
  const lang = language ? `?language=${language}` : "";
  const body = await getJson(`${BASE}/cardinfo.php${lang}`);
  if (!body) return [];
  const parsed = z.object({ data: z.array(YgoCardSchema) }).safeParse(body);
  if (!parsed.success) {
    throw new Error(`Dump YGOPRODeck illisible : ${parsed.error.issues[0]?.message ?? "?"}`);
  }
  return parsed.data.data;
}
