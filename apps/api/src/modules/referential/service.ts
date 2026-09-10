/**
 * Le module referential — le catalogue de cartes et d'impressions.
 *
 * C'est le **seul** module qui écrit dans `cards` et `card_prints`. ATEM-old
 * laissait `collection` et `decks` y écrire directement, ce qui a produit trois
 * implémentations concurrentes de « carte pas encore résolue ». Les autres
 * modules passent désormais par les fonctions exportées ici.
 */
import { and, eq, sql } from "drizzle-orm";
import {
  canonicalSetCode, languageFromSetCode, normalizeSetCode, toEnglishLookupSetCode,
} from "@atem/shared";
import type { Database } from "../../db/client.js";
import { cardPrints, cards, type CardPrintRow, type CardRow } from "./schema.js";
import { fetchCardById, fetchSetInfo, type YgoCard } from "./ygoprodeck.js";

export type CardDetail = {
  passcode: number;
  name: string;
  desc: string | null;
  /**
   * Vrai quand la carte n'est **pas encore** traduite dans le catalogue.
   *
   * 2 863 cartes sur 14 524 n'ont aucune donnée française chez YGOPRODeck — ni
   * nom, ni texte. Et ce n'est pas une lacune définitive : mesuré par extension,
   * les anciennes sont couvertes à 100 % (LOB, MRD, PSV, LON…) et les récentes
   * à 0-60 % (ALIN 0 %, CORI 0 %, MP25 17 %, RA05 60 %). **La source accuse un
   * retard**, elle ne renonce pas.
   *
   * La distinction compte pour ce qu'on affiche : « cette carte n'a pas de nom
   * français » est faux — « Aspischool » s'appelle « Banc d'aspis » —, alors que
   * « pas encore dans le catalogue » est vrai et laisse espérer la prochaine
   * synchronisation, qui les remplira.
   */
  frenchPending: boolean;
  type: string | null;
  frameType: string | null;
  race: string | null;
  attribute: string | null;
  atk: number | null;
  def: number | null;
  level: number | null;
  scale: number | null;
  linkValue: number | null;
  linkMarkers: string[] | null;
  archetype: string | null;
  banlistTcg: string | null;
  imageUrl: string | null;
  imageUrlSmall: string | null;
};

/**
 * Le nom et le texte affichés suivent la langue demandée, avec repli sur
 * l'anglais — 2 863 cartes sur 14 524 n'ont pas de version française.
 */
export function toCardDetail(row: CardRow, locale: string): CardDetail {
  const wantsFr = locale === "fr";
  return {
    passcode: row.passcode,
    name: (wantsFr ? row.nameFr : null) ?? row.nameEn,
    desc: (wantsFr ? row.descFr : null) ?? row.descEn,
    // Le nom et le texte manquent ensemble : aucune carte n'a l'un sans l'autre
    // (vérifié sur les 11 661 traduites). Un seul drapeau suffit.
    frenchPending: wantsFr && !row.nameFr,
    type: row.type,
    frameType: row.frameType,
    race: row.race,
    attribute: row.attribute,
    atk: row.atk,
    def: row.def,
    level: row.level,
    scale: row.scale,
    linkValue: row.linkValue,
    linkMarkers: row.linkMarkers,
    archetype: row.archetype,
    banlistTcg: row.banlistTcg,
    imageUrl: row.imageUrl,
    imageUrlSmall: row.imageUrlSmall,
  };
}

export function cardFromYgo(en: YgoCard, fr?: YgoCard | null) {
  const image = en.card_images?.[0];
  return {
    passcode: en.id,
    nameEn: en.name,
    nameFr: fr?.name ?? null,
    descEn: en.desc ?? null,
    descFr: fr?.desc ?? null,
    type: en.type ?? null,
    frameType: en.frameType ?? null,
    race: en.race ?? null,
    attribute: en.attribute ?? null,
    atk: en.atk ?? null,
    def: en.def ?? null,
    level: en.level ?? null,
    scale: en.scale ?? null,
    linkValue: en.linkval ?? null,
    linkMarkers: en.linkmarkers ?? null,
    archetype: en.archetype ?? null,
    banlistTcg: en.banlist_info?.ban_tcg ?? null,
    imageUrl: image?.image_url ?? null,
    imageUrlSmall: image?.image_url_small ?? null,
  };
}

/**
 * Enregistre une carte, **sans effacer ce qu'on savait déjà d'elle**.
 *
 * Les champs localisés sont fusionnés, pas écrasés : `fetchCardById(id, "fr")`
 * rend `null` dès que l'API renvoie une erreur ou une charge utile qu'elle ne
 * sait pas relire, et un simple `set: {...input}` remplaçait alors le nom
 * français d'une carte par rien — au premier hoquet du point d'entrée français,
 * pendant qu'un joueur résolvait un scan.
 *
 * `coalesce(nouveau, ancien)` garde la traduction connue tant qu'une meilleure
 * n'arrive pas. Une absence n'est pas une correction.
 */
export async function upsertCard(db: Database, input: ReturnType<typeof cardFromYgo>) {
  const keepKnown = (column: string) =>
    sql.raw(`coalesce(excluded.${column}, "cards".${column})`);

  await db
    .insert(cards)
    .values(input)
    .onConflictDoUpdate({
      target: cards.passcode,
      set: {
        ...input,
        nameFr: keepKnown("name_fr"),
        descFr: keepKnown("desc_fr"),
        updatedAt: new Date(),
      },
    });
}

/**
 * Crée ou met à jour une impression.
 *
 * L'identité est `(set_code, rarity, language)` — une même carte existe en
 * plusieurs raretés sous le même code. ATEM-old cherchait la ligne existante par
 * `LIMIT 20` puis filtrage en mémoire, alors qu'un index unique porte exactement
 * ces trois colonnes : au-delà de vingt impressions partageant un set code, il
 * ratait silencieusement la ligne et en créait une seconde.
 */
export async function upsertPrint(
  db: Database,
  input: {
    setCode: string;
    cardPasscode: number | null;
    setName?: string | null;
    rarity?: string | null;
    language?: string | null;
  },
): Promise<CardPrintRow> {
  const setCode = normalizeSetCode(input.setCode);
  const values = {
    setCode,
    canonicalSetCode: canonicalSetCode(setCode),
    cardPasscode: input.cardPasscode,
    setName: input.setName ?? null,
    rarity: input.rarity?.trim() ?? "",
    language: (input.language ?? languageFromSetCode(setCode)).toLowerCase(),
    resolveStatus: input.cardPasscode === null ? "pending" : "resolved",
  };

  const [row] = await db
    .insert(cardPrints)
    .values(values)
    .onConflictDoUpdate({
      target: [cardPrints.setCode, cardPrints.rarity, cardPrints.language],
      set: {
        cardPasscode: values.cardPasscode,
        setName: values.setName,
        canonicalSetCode: values.canonicalSetCode,
        resolveStatus: values.resolveStatus,
        updatedAt: new Date(),
      },
    })
    .returning();

  if (!row) throw new Error(`upsert d'impression sans résultat pour ${setCode}`);
  return row;
}

/**
 * Inscrit une impression **sans attendre le réseau**.
 *
 * `POST /collection` doit répondre tout de suite : le joueur vient de scanner
 * une carte et attend son « +1 ». La ligne existe donc immédiatement, en
 * `pending`, et la résolution se fait ensuite. C'est le besoin légitime derrière
 * les « stubs » d'ATEM-old — sans le passcode négatif.
 */
export async function ensurePlaceholderPrint(
  db: Database,
  rawSetCode: string,
  options: {
    language?: string | null;
    /** Le passcode, s'il est connu : huit chiffres en bas à gauche de la carte. */
    passcode?: number | null;
  } = {},
): Promise<CardPrintRow> {
  const setCode = normalizeSetCode(rawSetCode);
  const language = (options.language ?? languageFromSetCode(setCode)).toLowerCase();

  /**
   * Un passcode fourni tranche tout de suite, sans attendre l'identification.
   *
   * C'est le recours quand le set code est illisible — carte abîmée, pochette,
   * mauvaise lumière : les huit chiffres, eux, restent lisibles. On ne s'en sert
   * que si la carte est **déjà** au catalogue : aller la chercher demanderait un
   * appel réseau, et rien ne sort sur le chemin d'une requête.
   */
  if (options.passcode) {
    const [card] = await db
      .select({ passcode: cards.passcode })
      .from(cards)
      .where(eq(cards.passcode, options.passcode))
      .limit(1);
    if (card) {
      return upsertPrint(db, { setCode, cardPasscode: card.passcode, language });
    }
  }

  const existing = await findLocalPrint(db, setCode, { language });

  // Rien de connu : une ligne provisoire, que la file de résolution reprendra.
  if (!existing) {
    return upsertPrint(db, { setCode, cardPasscode: null, language });
  }

  // Trouvée sous le code exact du joueur : rien à faire.
  if (existing.setCode === setCode) return existing;

  /**
   * Trouvée sous une **autre notation** du même code — le cas normal après un
   * import complet du catalogue, qui ne contient que les codes anglais.
   *
   * On matérialise alors le code réellement imprimé sur la carte du joueur, en
   * reprenant la carte et l'édition déjà connues. Sans ça, sa ligne pointerait
   * vers l'impression anglaise : le nom s'afficherait en anglais sur une carte
   * française, et l'export lui rendrait un code qu'il n'a jamais saisi.
   *
   * Vu à l'écran avant d'être vu dans le code.
   */
  return upsertPrint(db, {
    setCode,
    cardPasscode: existing.cardPasscode,
    setName: existing.setName,
    rarity: existing.rarity,
    language,
  });
}

/**
 * Inscrit qu'un code n'existe pas chez YGOPRODeck.
 *
 * Trois états, et le troisième ne servait à rien : la base déclarait
 * `unidentified`, la collection le comptait, l'écran l'affichait — mais rien ne
 * l'écrivait jamais. Une impression que la file avait renoncé à identifier
 * restait `pending`, donc indistinguable d'une résolution simplement
 * interrompue. Conséquence : chaque redémarrage la remettait en file, pour
 * redemander un code dont on savait déjà qu'il n'existe pas.
 *
 * C'est l'état terminal des codes suffixés du wiki français — voir
 * `docs/01-domain-model.md`.
 *
 * On ne touche que les lignes `pending` : une impression identifiée entre-temps
 * par un autre chemin ne doit pas être défaite.
 */
export async function markUnidentified(db: Database, rawSetCode: string): Promise<number> {
  const setCode = normalizeSetCode(rawSetCode);
  if (!setCode) return 0;

  const touched = await db
    .update(cardPrints)
    .set({ resolveStatus: "unidentified" })
    .where(
      and(
        eq(cardPrints.canonicalSetCode, canonicalSetCode(setCode)),
        eq(cardPrints.resolveStatus, "pending"),
      ),
    )
    .returning({ id: cardPrints.id });

  return touched.length;
}

/**
 * Cherche une impression déjà connue localement.
 *
 * On tente le code exact, puis son équivalent anglais : une carte française dont
 * seule l'édition anglaise est en base est la même carte, et il ne faut pas
 * repartir sur le réseau pour l'apprendre. La préférence va à la rareté et à la
 * langue exactes, puis à la rareté seule, puis à la langue seule — cet ordre est
 * une politique métier héritée d'ATEM-old, pas un hasard.
 */
async function findLocalPrint(
  db: Database,
  setCode: string,
  hints: { rarity?: string; language: string },
): Promise<CardPrintRow | null> {
  // On joint sur la forme canonique : `LOB-001` et `LOB-EN001` sont la même
  // impression, et les deux formes existent dans la source comme sur les cartes.
  const rows = await db
    .select()
    .from(cardPrints)
    .where(eq(cardPrints.canonicalSetCode, canonicalSetCode(setCode)));

  if (rows.length === 0) return null;

  /**
   * Une impression identifiée l'emporte toujours sur une provisoire.
   *
   * Sans cette priorité, une ligne provisoire créée au scan — rareté vide, donc
   * correspondance « exacte » avec les indices d'un second scan tout aussi
   * vague — était préférée à la vraie édition arrivée entre-temps, et la
   * consolidation ne se déclenchait jamais. Trouvé en écrivant le test de
   * consolidation, pas en relisant le code.
   */
  const preference = (candidates: CardPrintRow[]): CardPrintRow | null => {
    const exact = candidates.find(
      (r) =>
        r.setCode === setCode &&
        r.rarity === (hints.rarity ?? "") &&
        r.language === hints.language,
    );
    if (exact) return exact;

    const sameCode = candidates.find((r) => r.setCode === setCode && r.language === hints.language);
    if (sameCode) return sameCode;

    const byRarity = candidates.find((r) => r.rarity === (hints.rarity ?? ""));
    if (byRarity) return byRarity;

    return candidates[0] ?? null;
  };

  const resolved = rows.filter((r) => r.resolveStatus === "resolved");
  return preference(resolved) ?? preference(rows);
}

/**
 * Résout un set code physique en impression complète.
 *
 * Le code interrogé est l'équivalent **anglais** — seuls ceux-là sont indexés
 * chez YGOPRODeck. Le code réellement imprimé sur la carte du joueur reste
 * l'identité de son impression : c'est ce qu'il voit, ce qu'il scanne, et ce
 * qu'il retrouve à l'export.
 */
export async function resolvePrintBySetCode(
  db: Database,
  rawSetCode: string,
  options: { rarity?: string | null; language?: string | null; allowRemote?: boolean } = {},
): Promise<CardPrintRow | null> {
  const setCode = normalizeSetCode(rawSetCode);
  const language = (options.language ?? languageFromSetCode(setCode)).toLowerCase();
  const rarity = options.rarity?.trim() ?? "";

  const local = await findLocalPrint(db, setCode, { rarity, language });
  if (local?.resolveStatus === "resolved") {
    if (local.setCode === setCode) return local;
    // La carte est connue, mais sous son code anglais. On matérialise le code
    // du joueur sans repartir sur le réseau.
    return upsertPrint(db, {
      setCode,
      cardPasscode: local.cardPasscode,
      setName: local.setName,
      rarity: rarity || local.rarity,
      language,
    });
  }

  if (options.allowRemote === false) return local;

  const info = await fetchSetInfo(toEnglishLookupSetCode(setCode));
  if (!info) return local;

  const [en, fr] = await Promise.all([fetchCardById(info.id), fetchCardById(info.id, "fr")]);
  if (!en) return local;

  await upsertCard(db, cardFromYgo(en, fr));

  const print = await upsertPrint(db, {
    setCode,
    cardPasscode: info.id,
    setName: info.set_name ?? null,
    rarity: rarity || info.set_rarity?.trim() || "",
    language,
  });

  // On enregistre aussi la contrepartie anglaise : la prochaine carte de la même
  // édition, dans n'importe quelle langue, se résoudra sans appel réseau.
  const english = toEnglishLookupSetCode(setCode);
  if (english !== setCode) {
    await upsertPrint(db, {
      setCode: english,
      cardPasscode: info.id,
      setName: info.set_name ?? null,
      rarity: info.set_rarity?.trim() || "",
      language: "en",
    });
  }

  return print;
}

export async function getCard(
  db: Database,
  passcode: number,
  locale: string,
): Promise<CardDetail | null> {
  const [row] = await db.select().from(cards).where(eq(cards.passcode, passcode)).limit(1);
  return row ? toCardDetail(row, locale) : null;
}

/** Les impressions d'une carte, pour choisir l'édition que l'on possède. */
export async function listPrintsForCard(db: Database, passcode: number) {
  return db
    .select()
    .from(cardPrints)
    .where(and(eq(cardPrints.cardPasscode, passcode), eq(cardPrints.resolveStatus, "resolved")))
    .orderBy(cardPrints.setCode);
}

/**
 * La vue que les autres modules joignent.
 *
 * `collection` a besoin de filtrer, trier et paginer sur des attributs qui
 * appartiennent au référentiel — le nom d'une carte, son attribut, son niveau,
 * la rareté de l'impression. Le faire en mémoire imposerait de tout charger
 * pour compter ; le faire en SQL imposait jusqu'ici d'importer nos tables, ce
 * qui rouvre exactement la porte par laquelle ATEM-old s'est perdu.
 *
 * On expose donc une **sous-requête nommée**, aux colonnes stables. Les autres
 * modules la joignent comme une table, filtrent et trient dessus, et n'ont
 * jamais à savoir comment `cards` et `card_prints` sont faites — ni le droit
 * d'y écrire.
 */
export function printIndex(db: Database) {
  return db
    .select({
      printId: cardPrints.id,
      setCode: cardPrints.setCode,
      setName: cardPrints.setName,
      rarity: cardPrints.rarity,
      language: cardPrints.language,
      resolveStatus: cardPrints.resolveStatus,
      passcode: cards.passcode,
      /**
       * Le nom **imprimé sur l'exemplaire**, choisi ici plutôt que chez
       * l'appelant : c'est une règle du référentiel, et la calculer en SQL
       * permet de trier et de chercher dessus sans charger toute la collection.
       *
       * Une carte achetée en anglais reste affichée en anglais sous une
       * interface française — c'est ce qui est écrit sur le carton posé sur la
       * table. ATEM-old faisait `nameFr ?? nameEn` sans condition et montrait
       * des noms français à un anglophone.
       */
      name: sql<string>`coalesce(
        case when ${cardPrints.language} = 'fr' then ${cards.nameFr} end,
        ${cards.nameEn},
        ${cardPrints.setCode}
      )`.as("printed_name"),
      nameEn: cards.nameEn,
      nameFr: cards.nameFr,
      descEn: cards.descEn,
      descFr: cards.descFr,
      type: cards.type,
      frameType: cards.frameType,
      race: cards.race,
      attribute: cards.attribute,
      atk: cards.atk,
      def: cards.def,
      level: cards.level,
      scale: cards.scale,
      linkValue: cards.linkValue,
      linkMarkers: cards.linkMarkers,
      archetype: cards.archetype,
      banlistTcg: cards.banlistTcg,
      imageUrl: cards.imageUrl,
      imageUrlSmall: cards.imageUrlSmall,
    })
    .from(cardPrints)
    // `left join` : une impression pas encore identifiée n'a pas de carte, et
    // elle doit rester visible — c'est justement celle qu'on veut corriger.
    .leftJoin(cards, eq(cardPrints.cardPasscode, cards.passcode))
    .as("print_index");
}

export type PrintIndex = ReturnType<typeof printIndex>;
