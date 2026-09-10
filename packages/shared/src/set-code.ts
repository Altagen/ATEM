/**
 * Identité d'une carte imprimée : le code lu sur la carte elle-même.
 *
 * Ce fichier vit dans `shared` et non dans le module `referential` : un set code
 * n'est pas une donnée de carte, c'est l'identité que la collection stocke et que
 * les fichiers d'import/export transportent. Trois modules en dépendent.
 */

/**
 * Les codes de région rencontrés dans la base YGOPRODeck, du plus long au plus
 * court — l'ordre compte pour le découpage.
 *
 * Les codes à une lettre sont ceux des éditions européennes anciennes (`PSV-E088`).
 * Mesuré sur les 44 517 impressions réelles : 38 818 en `EN`, 1 808 sans aucun code
 * de région, 456 en `PT`, 4 en `SE`, et 3 431 que la forme naïve `PREFIXE-XX999`
 * ne sait pas découper — d'où le découpage ci-dessous.
 */
const REGIONS_LONGUES = [
  "EN", "FR", "DE", "IT", "PT", "SP", "ES", "JP", "JA", "KR", "AE", "SE",
] as const;
const REGIONS_COURTES = ["E", "F", "G", "I", "S", "P", "A"] as const;

/** Équivalent anglais d'un code de région, à largeur constante. */
const VERS_ANGLAIS: Record<string, string> = {
  FR: "EN", DE: "EN", IT: "EN", PT: "EN", SP: "EN", ES: "EN",
  JP: "EN", JA: "EN", KR: "EN", AE: "EN", SE: "EN", EN: "EN",
  // Éditions européennes anciennes : la contrepartie anglaise garde une seule lettre.
  F: "E", G: "E", I: "E", S: "E", P: "E", A: "E", E: "E",
};

export type SetCodeParts = {
  /** Le préfixe d'extension : `LOB`, `NECH`. */
  prefix: string;
  /** Le code de région, ou `null` si la carte n'en porte pas (`BPT-001`). */
  region: string | null;
  /**
   * Le numéro d'impression, tel qu'imprimé — il peut commencer par une lettre
   * (`NECH-ENS10` → `S10`, `SOI-ENSE1` → `SE1`).
   */
  number: string;
};

/** Forme canonique : majuscules, espaces réduits à un tiret. */
export function normalizeSetCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "-");
}

/**
 * Découpe un set code en préfixe / région / numéro.
 *
 * On essaie les régions à deux lettres avant celles à une lettre, sinon `PSV-E088`
 * se découperait sur une région `E0` inexistante. Un numéro peut commencer par une
 * lettre, ce que la version d'ATEM-old ne savait pas lire : sa forme
 * `([A-Z0-9]{2,5})-([A-Z]{2})(\d{3,4})` laissait 3 431 impressions non traduites,
 * dont toutes les éditions européennes à une lettre.
 */
export function parseSetCode(raw: string): SetCodeParts | null {
  const normalized = normalizeSetCode(raw);
  const separator = normalized.lastIndexOf("-");
  if (separator <= 0 || separator === normalized.length - 1) return null;

  const prefix = normalized.slice(0, separator);
  const rest = normalized.slice(separator + 1);
  if (!/^[A-Z0-9]+$/.test(prefix)) return null;

  for (const region of REGIONS_LONGUES) {
    if (rest.startsWith(region) && rest.length > region.length) {
      return { prefix, region, number: rest.slice(region.length) };
    }
  }
  for (const region of REGIONS_COURTES) {
    if (rest.startsWith(region) && rest.length > region.length) {
      return { prefix, region, number: rest.slice(region.length) };
    }
  }
  return { prefix, region: null, number: rest };
}

/**
 * La langue déduite du code imprimé. `LTGY-FR008` → `fr`.
 *
 * Un code sans région est anglais : ce sont les premières éditions, distribuées
 * uniquement en anglais.
 */
export function languageFromSetCode(raw: string): string {
  const parts = parseSetCode(raw);
  if (!parts?.region) return "en";
  const lang = parts.region.length === 1 ? SHORT_TO_LANG[parts.region] : parts.region;
  return (lang ?? "en").toLowerCase();
}

/** Les régions à une lettre ne disent pas la langue de la même façon. */
const SHORT_TO_LANG: Record<string, string> = {
  E: "en", F: "fr", G: "de", I: "it", S: "es", P: "pt", A: "en",
};

/**
 * La forme canonique servant de **clé de jointure locale** : région retirée.
 *
 * `LOB-001` et `LOB-EN001` désignent la même impression — les cartes anglaises
 * de 2002 portaient la forme sans région, les rééditions européennes la forme
 * avec. Pire, les deux points d'entrée de YGOPRODeck ne s'accordent pas : le
 * dump complet écrit `LOB-001`, tandis que `cardsetsinfo.php` répond sur
 * `LOB-EN001`. Joindre sur le code tel qu'écrit laisserait donc deux moitiés du
 * catalogue s'ignorer.
 *
 * Mesuré sur les 44 517 impressions réelles : 33 935 clés canoniques, dont
 * seulement 8 pointent vers deux cartes distinctes (0,02 %). L'écran de
 * correction manuelle du scan absorbe ces cas.
 */
export function canonicalSetCode(raw: string): string {
  const parts = parseSetCode(raw);
  if (!parts) return normalizeSetCode(raw);
  return `${parts.prefix}-${parts.number}`;
}

/**
 * Le code à interroger chez YGOPRODeck pour un code physique donné.
 *
 * Mesuré : `cardsetsinfo.php` ne connaît **que** les codes anglais. `LOB-EN001` et
 * `PSV-E088` répondent, `LOB-FR001` et `SDK-FR001` renvoient « No card matching ».
 * On bascule donc la région vers son équivalent anglais pour interroger, et on
 * conserve le code physique comme identité de l'impression du joueur.
 */
export function toEnglishLookupSetCode(raw: string): string {
  const parts = parseSetCode(raw);
  if (!parts?.region) return normalizeSetCode(raw);
  const english = VERS_ANGLAIS[parts.region];
  if (!english || english === parts.region) return normalizeSetCode(raw);
  return `${parts.prefix}-${english}${parts.number}`;
}
