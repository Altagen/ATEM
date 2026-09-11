/**
 * Les règles de construction d'un deck.
 *
 * Logique pure, partagée par le serveur et l'écran : l'atelier grise un bouton
 * avec la même fonction que celle qui refuse l'écriture. ATEM-old avait déjà
 * écrit l'essentiel — et ne l'appelait **jamais côté serveur**. C'était un
 * utilitaire d'affichage, pas une garde.
 *
 * **Un deck compte des cartes, pas des impressions.** Trois Dragons Blancs en
 * trois codes d'extension différents restent trois Dragons Blancs pour la règle
 * des trois exemplaires. C'est la règle du jeu, et c'est aussi ce qui rend le
 * plafond exprimable en base : `deck_cards` porte une ligne par carte, et une
 * contrainte de table refuse le quatrième exemplaire.
 *
 * ATEM-old ne pouvait pas l'exprimer : son identité de ligne était
 * `(deck, zone, passcode, set_code)`, si bien que la même carte vivait sur
 * plusieurs lignes et totalisait six exemplaires sans qu'aucune contrainte
 * n'agrège. Le plafond était vérifié **par ligne**.
 */

/** Les trois zones d'un deck. Le plafond de trois porte sur leur somme. */
export const DECK_ZONES = ["main", "extra", "side"] as const;
export type DeckZone = (typeof DECK_ZONES)[number];

/**
 * Le plafond absolu : trois exemplaires d'une carte dans tout le deck.
 *
 * Il ne dépend ni de la banlist ni de la date. C'est pour ça qu'il vit en base,
 * dans une contrainte, et non dans du code qu'on pourrait oublier d'appeler.
 */
export const DECK_MAX_COPIES = 3;

/**
 * Les tailles de zone, telles que les règles du jeu les fixent.
 *
 * **Le maximum se refuse, le minimum se signale.** Une soixante-et-unième carte
 * au Main Deck n'est légale dans aucune situation : on la refuse. Un deck à
 * douze cartes, lui, est un deck en cours de construction — le refuser
 * empêcherait de le construire. La distinction est la même que pour la règle
 * des trois exemplaires : ce qui ne peut jamais être vrai est interdit, ce qui
 * n'est pas encore vrai est dit.
 */
export const DECK_ZONE_LIMITS = {
  main: { min: 40, max: 60 },
  extra: { min: 0, max: 15 },
  side: { min: 0, max: 15 },
} as const satisfies Record<DeckZone, { min: number; max: number }>;

/** Un deck est-il jouable en l'état ? Tailles tenues, et rien qui manque. */
export function deckIsPlayable(counts: Record<DeckZone, number>, missing: number): boolean {
  if (missing > 0) return false;
  return DECK_ZONES.every((zone) => {
    const { min, max } = DECK_ZONE_LIMITS[zone];
    return counts[zone] >= min && counts[zone] <= max;
  });
}

export type BanlistStatus = "unlimited" | "semi_limited" | "limited" | "forbidden";

/**
 * Normalise ce que le catalogue écrit.
 *
 * YGOPRODeck rend « Banned », « Limited », « Semi-Limited » — et certains flux
 * rendent un chiffre. Les deux formes sont acceptées : les avoir vues suffit à
 * savoir qu'on ne choisit pas ce qu'on reçoit.
 */
export function parseBanlistStatus(raw: string | null | undefined): BanlistStatus {
  const value = String(raw ?? "").trim().toLowerCase().replace(/[_-]+/g, " ");
  if (!value) return "unlimited";
  if (value.includes("forbidden") || value === "banned" || value === "ban") return "forbidden";
  if (value.includes("semi")) return "semi_limited";
  if (value.includes("limited") || value === "limit") return "limited";
  if (value === "0") return "forbidden";
  if (value === "1") return "limited";
  if (value === "2") return "semi_limited";
  return "unlimited";
}

/** Ce que la banlist autorise : interdite → 0, limitée → 1, semi → 2, sinon 3. */
export function banlistMaxCopies(status: BanlistStatus): number {
  switch (status) {
    case "forbidden": return 0;
    case "limited": return 1;
    case "semi_limited": return 2;
    default: return DECK_MAX_COPIES;
  }
}

/**
 * Une carte va-t-elle à l'Extra Deck ?
 *
 * La question se pose sur le `type` et le `frameType` du catalogue, tous deux en
 * anglais quelle que soit la langue demandée. Un monstre Pendule qui est aussi
 * Fusion ou Synchro va à l'Extra : c'est le cadre qui tranche, pas le nom.
 */
export function isExtraDeckCard(card: { type?: string | null; frameType?: string | null }): boolean {
  const blob = `${card.type ?? ""} ${card.frameType ?? ""}`.toLowerCase();
  return /\b(fusion|synchro|xyz|link)\b/.test(blob);
}

/**
 * Ce qui empêche d'en mettre davantage — ou `null` si rien n'empêche.
 *
 * Quatre bornes, quatre raisons, toutes atteignables. Il n'y a pas de valeur
 * « ok » : l'absence d'empêchement s'écrit `null`, ce qui évite une clé de plus
 * dans les tables de messages — une clé qu'aucun chemin n'atteindrait.
 */
export type DeckBlockReason = "forbidden" | "banlist" | "not_owned" | "max_copies";

export type DeckAddCheck = {
  status: BanlistStatus;
  /** Ce que la banlist autorise. */
  legalMax: number;
  /**
   * Le plafond réel : `min(3, possédés)`.
   *
   * Décision d'Ange : **un deck est borné par la collection.** On ne peut pas y
   * mettre une carte qu'on n'a pas, et un deck est donc jouable par
   * construction. C'est ce qui rend le calcul « possédé / manquant » d'ATEM-old
   * sans objet — il n'y a rien à manquer au moment où l'on ajoute.
   */
  hardCap: number;
  /** Déjà présents dans tout le deck, main + extra + side confondus. */
  inDeck: number;
  /** Ce qu'on peut encore ajouter en restant légal. */
  remainingLegal: number;
  canAdd: boolean;
  /** Ce qui empêche, ou `null` si rien n'empêche. */
  blockedBy: DeckBlockReason | null;
};

/**
 * Peut-on porter cette carte à `wanted` exemplaires de plus ?
 *
 * Une seule fonction répond, et les deux côtés l'appellent : l'atelier pour
 * griser son bouton — `wanted` vaut alors 1, « un de plus » —, le serveur pour
 * refuser une écriture qui pose un état. Deux implémentations finiraient par
 * diverger, et c'est celle du serveur qui compte.
 *
 * `wanted` est ce qui a supprimé un détour : le serveur demandait « puis-je en
 * ajouter un ? », recevait « oui » — rien ne bloque le *premier* exemplaire —
 * puis devait réinterroger la fonction **au bord** du plafond pour savoir quoi
 * répondre. Il pose maintenant sa vraie question du premier coup.
 */
export function checkDeckAdd(opts: {
  banlistTcg?: string | null;
  owned: number;
  inDeck: number;
  /** Combien on veut en plus. 1 par défaut : « un de plus ». */
  wanted?: number;
}): DeckAddCheck {
  const status = parseBanlistStatus(opts.banlistTcg);
  const legalMax = banlistMaxCopies(status);
  const owned = Math.max(0, Math.trunc(opts.owned));
  const inDeck = Math.max(0, Math.trunc(opts.inDeck));
  const hardCap = Math.min(DECK_MAX_COPIES, owned);
  const remainingLegal = Math.max(0, Math.min(legalMax, hardCap) - inDeck);
  const wanted = Math.max(1, Math.trunc(opts.wanted ?? 1));

  /**
   * L'ordre des refus est celui qui explique le mieux.
   *
   * Une carte interdite qu'on ne possède pas se refuse pour la banlist, pas
   * pour la collection : c'est l'information qui décide, celle qu'on n'aurait
   * pas devinée. L'inverse enverrait acheter une carte injouable.
   *
   * Et la règle du jeu passe avant la banlist : à trois exemplaires les deux
   * s'appliquent, mais c'est « trois par deck » qu'il faut dire, pas « la
   * banlist en autorise trois ».
   */
  const canAdd = wanted <= remainingLegal;

  /**
   * La raison se juge **au plafond**, pas à l'état courant.
   *
   * Demander trois exemplaires quand deux sont permis n'est pas bloqué par le
   * premier : c'est le troisième qui bloque. On regarde donc ce qui se passe au
   * bord — `inDeck + remainingLegal`, l'état qu'on aurait en prenant tout ce
   * qui reste.
   */
  const auBord = inDeck + remainingLegal;
  let blockedBy: DeckBlockReason | null = null;
  if (!canAdd) {
    if (status === "forbidden") blockedBy = "forbidden";
    else if (owned === 0) blockedBy = "not_owned";
    else if (auBord >= DECK_MAX_COPIES) blockedBy = "max_copies";
    else if (auBord >= legalMax) blockedBy = "banlist";
    else blockedBy = "not_owned";
  }

  return { status, legalMax, hardCap, inDeck, remainingLegal, canAdd, blockedBy };
}

/**
 * Ce qui manque à un deck pour être jouable — **et rien d'autre**.
 *
 * Un deck est borné par la collection à l'ajout, mais la collection bouge
 * ensuite : on vend une carte, on la donne. Le manque se calcule donc à la
 * lecture, carte par carte, et **seulement quand il y en a un**.
 *
 * Quatre exemplaires possédés, trois au deck, un vendu : `max(0, 3 − 3) = 0`.
 * Il ne se passe rien, et rien ne s'affiche. Le silence quand tout va bien.
 */
export const missingCopies = (inDeck: number, owned: number): number =>
  Math.max(0, inDeck - owned);
