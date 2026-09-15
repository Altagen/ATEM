/**
 * The referential module — the catalogue of cards and printings.
 *
 * It is the **only** module that writes into `cards` and `card_prints`.
 * ATEM-old let `collection` and `decks` write there directly, which produced
 * three competing implementations of “card not resolved yet”. Other modules now
 * go through the functions exported here.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
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
   * True when the card is **not yet** translated in the catalogue.
   *
   * 2,863 cards out of 14,524 have no French data at YGOPRODeck — no name, no
   * text. And it is not a permanent gap: measured per set, old ones are covered
   * 100% (LOB, MRD, PSV, LON…) and recent ones 0–60% (ALIN 0%, CORI 0%, MP25
   * 17%, RA05 60%). **The source is behind**, it has not given up.
   *
   * The distinction matters for what we display: “this card has no French name”
   * is false — “Aspischool” is called « Banc d'aspis » — whereas “not in the
   * catalogue yet” is true and leaves hope for the next sync, which will fill
   * them in.
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
 * The displayed name and text follow the requested language, falling back to
 * English — 2,863 cards out of 14,524 have no French version.
 */
export function toCardDetail(row: CardRow, locale: string): CardDetail {
  const wantsFr = locale === "fr";
  return {
    passcode: row.passcode,
    name: (wantsFr ? row.nameFr : null) ?? row.nameEn,
    desc: (wantsFr ? row.descFr : null) ?? row.descEn,
    // Name and text are missing together: no card has one without the other
    // (checked over the 11,661 translated ones). One flag is enough.
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
 * Saves a card **without erasing what we already knew about it**.
 *
 * Localised fields are merged, not overwritten: `fetchCardById(id, "fr")`
 * returns `null` as soon as the API answers with an error or a payload it
 * cannot read back, and a plain `set: {...input}` then replaced a card's French
 * name with nothing — at the first hiccup of the French endpoint, while a
 * player was resolving a scan.
 *
 * `coalesce(new, old)` keeps the known translation until a better one arrives.
 * An absence is not a correction.
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
 * Creates or updates a printing.
 *
 * The identity is `(set_code, rarity, language)` — the same card exists in
 * several rarities under one code. ATEM-old looked the existing row up with
 * `LIMIT 20` then filtered in memory, while a unique index carries exactly
 * those three columns: past twenty printings sharing a set code, it silently
 * missed the row and created a second one.
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

  if (!row) throw new Error(`printing upsert returned nothing for ${setCode}`);
  return row;
}

/**
 * Records a printing **without waiting for the network**.
 *
 * `POST /collection` must answer right away: the player has just scanned a card
 * and is waiting for their “+1”. So the row exists immediately, as `pending`,
 * and resolution happens afterwards. This is the legitimate need behind
 * ATEM-old's “stubs” — without the negative passcode.
 */
export async function ensurePlaceholderPrint(
  db: Database,
  rawSetCode: string,
  options: {
    language?: string | null;
    /** The passcode, when known: eight digits at the bottom left of the card. */
    passcode?: number | null;
  } = {},
): Promise<CardPrintRow> {
  const setCode = normalizeSetCode(rawSetCode);
  const language = (options.language ?? languageFromSetCode(setCode)).toLowerCase();

  /**
   * A supplied passcode settles the identity without waiting for the network.
   *
   * It is the fallback when the set code is unreadable — damaged card, sleeve,
   * bad light: the eight digits stay legible. We use it only if the card is
   * **already** in the catalogue: fetching it would require a network call, and
   * nothing goes out on a request's path.
   *
   * **It does not excuse ignoring what we already know.** This path used to
   * return a brand-new printing directly, with no rarity and without consulting
   * the local index: adding `ALIN-FR084` with its passcode therefore built a
   * second printing of the same code and language, with an empty rarity, next
   * to the one resolution had already established as “Common”. Two rows for the
   * same card in the collection, and the same code displayed twice.
   *
   * The passcode now only serves to **name the card**; the rest goes through
   * the common path.
   */
  const knownCard = options.passcode
    ? ((
        await db
          .select({ passcode: cards.passcode })
          .from(cards)
          .where(eq(cards.passcode, options.passcode))
          .limit(1)
      )[0]?.passcode ?? null)
    : null;

  const existing = await findLocalPrint(db, setCode, { language });

  // Nothing known: a provisional row, which the resolve queue will pick up —
  // or an already identified one, if the passcode told us.
  if (!existing) {
    return upsertPrint(db, { setCode, cardPasscode: knownCard, language });
  }

  // Found under the player's exact code: nothing to do — unless it
  // was still waiting and the passcode has just named it.
  if (existing.setCode === setCode) {
    if (knownCard !== null && existing.cardPasscode === null) {
      return upsertPrint(db, {
        setCode,
        cardPasscode: knownCard,
        setName: existing.setName,
        rarity: existing.rarity,
        language,
      });
    }
    return existing;
  }

  /**
   * Found under **another notation** of the same code — the normal case after a
   * full catalogue import, which only contains English codes.
   *
   * We then materialise the code actually printed on the player's card, reusing
   * the card and edition already known. Without that, their row would point at
   * the English printing: the name would display in English on a French card,
   * and the export would hand back a code they never typed.
   *
   * Seen on screen before being seen in the code.
   */
  return upsertPrint(db, {
    setCode,
    cardPasscode: existing.cardPasscode ?? knownCard,
    setName: existing.setName,
    rarity: existing.rarity,
    language,
  });
}

/**
 * Records that a code does not exist at YGOPRODeck.
 *
 * Three states, and the third served nothing: the database declared
 * `unidentified`, the collection counted it, the screen displayed it — but
 * nothing ever wrote it. A printing the queue had given up identifying stayed
 * `pending`, hence indistinguishable from a merely interrupted resolution.
 * Consequence: every restart queued it again, to ask once more for a code we
 * already knew did not exist.
 *
 * It is the terminal state of the French wiki's suffixed codes — see
 * `docs/01-domain-model.md`.
 *
 * We only touch `pending` rows: a printing identified in the meantime by
 * another path must not be undone.
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
 * Looks for a printing already known locally.
 *
 * We try the exact code, then its English counterpart: a French card whose
 * English edition alone is in the database is the same card, and there is no
 * need to go back on the network to learn it. Preference goes to the exact
 * rarity and language, then rarity alone, then language alone — that order is a
 * business policy inherited from ATEM-old, not an accident.
 */
async function findLocalPrint(
  db: Database,
  setCode: string,
  hints: { rarity?: string; language: string },
): Promise<CardPrintRow | null> {
  // We join on the canonical shape: `LOB-001` and `LOB-EN001` are the same
  // printing, and both shapes exist in the source as on the cards.
  const rows = await db
    .select()
    .from(cardPrints)
    .where(eq(cardPrints.canonicalSetCode, canonicalSetCode(setCode)));

  if (rows.length === 0) return null;

  /**
   * An identified printing always beats a provisional one.
   *
   * Without that priority, a provisional row created at scan time — empty
   * rarity, hence an “exact” match with the equally vague hints of a second
   * scan — was preferred over the real edition that had arrived in the
   * meantime, and consolidation never triggered. Found while writing the
   * consolidation test, not by rereading the code.
   */
  const wanted = hints.rarity?.trim() ?? "";

  const preference = (candidates: CardPrintRow[]): CardPrintRow | null => {
    // A requested rarity wins, when it exists.
    if (wanted) {
      const exact = candidates.find(
        (r) => r.setCode === setCode && r.rarity === wanted && r.language === hints.language,
      );
      if (exact) return exact;
    }

    /**
     * With no rarity requested, a **known** rarity beats an empty one.
     *
     * An empty rarity means “we do not know yet”, not “this printing has
     * none”. The previous version treated the empty string as a value: asked
     * without preference, it found the empty-rarity row “exactly” and preferred
     * it to the one resolution had established. A duplicate born elsewhere thus
     * became the canonical answer, and later additions piled onto it while the
     * older ones stayed on the other.
     */
    const sameCodeKnown = candidates.find(
      (r) => r.setCode === setCode && r.language === hints.language && r.rarity !== "",
    );
    if (sameCodeKnown) return sameCodeKnown;

    const sameCode = candidates.find((r) => r.setCode === setCode && r.language === hints.language);
    if (sameCode) return sameCode;

    if (wanted) {
      const byRarity = candidates.find((r) => r.rarity === wanted);
      if (byRarity) return byRarity;
    }

    return candidates[0] ?? null;
  };

  const resolved = rows.filter((r) => r.resolveStatus === "resolved");
  return preference(resolved) ?? preference(rows);
}

/**
 * Resolves a physical set code into a full printing.
 *
 * The code we query is the **English** counterpart — only those are indexed at
 * YGOPRODeck. The code actually printed on the player's card stays the identity
 * of their printing: it is what they see, what they scan, and what they find
 * again in the export.
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
    // The card is known, but under its English code. We materialise the
    // player's code without going back on the network.
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

  // We also record the English counterpart: the next card from the same
  // edition, in any language, will resolve without a network call.
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

/**
 * The records of a batch of cards, by passcode.
 *
 * Exposed for `deck`, which composes cards rather than printings: it needs the
 * name, the frame and the banlist status for forty cards at once. Asking one by
 * one would be forty queries where one suffices.
 *
 * Returning the rows as they are rather than a `CardDetail`: a deck's display
 * language follows the card, not the interface, and it is the caller who knows
 * what it shows.
 */
export async function cardsByPasscode(
  db: Database,
  passcodes: number[],
): Promise<Map<number, CardRow>> {
  if (passcodes.length === 0) return new Map();
  const rows = await db.select().from(cards).where(inArray(cards.passcode, passcodes));
  return new Map(rows.map((row) => [row.passcode, row]));
}

export async function getCard(
  db: Database,
  passcode: number,
  locale: string,
): Promise<CardDetail | null> {
  const [row] = await db.select().from(cards).where(eq(cards.passcode, passcode)).limit(1);
  return row ? toCardDetail(row, locale) : null;
}

/** A card's printings, to pick the edition one owns. */
export async function listPrintsForCard(db: Database, passcode: number) {
  return db
    .select()
    .from(cardPrints)
    .where(and(eq(cardPrints.cardPasscode, passcode), eq(cardPrints.resolveStatus, "resolved")))
    .orderBy(cardPrints.setCode);
}

/**
 * The view other modules join against.
 *
 * `collection` needs to filter, sort and paginate on attributes that belong to
 * the referential — a card's name, its attribute, its level, the printing's
 * rarity. Doing it in memory would mean loading everything to count; doing it
 * in SQL used to mean importing our tables, which reopens exactly the door
 * ATEM-old got lost through.
 *
 * So we expose a **named subquery**, with stable columns. Other modules join it
 * like a table, filter and sort on it, and never have to know how `cards` and
 * `card_prints` are built — nor any right to write into them.
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
       * The name **printed on the copy**, decided here rather than at the
       * caller: it is a rule of the referential, and computing it in SQL allows
       * sorting and searching on it without loading the whole collection.
       *
       * A card bought in English stays displayed in English under a French
       * interface — that is what is written on the cardboard lying on the
       * table. ATEM-old did `nameFr ?? nameEn` unconditionally and showed
       * French names to an English speaker.
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
    // `left join`: a printing not yet identified has no card, and
    // it must stay visible — it is precisely the one to be corrected.
    .leftJoin(cards, eq(cardPrints.cardPasscode, cards.passcode))
    .as("print_index");
}

export type PrintIndex = ReturnType<typeof printIndex>;
