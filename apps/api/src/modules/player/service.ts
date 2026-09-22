/**
 * The player module — someone's profile, as another duellist sees it.
 *
 * It owns no table: it gathers what `identity` and `deck` expose. **It only
 * reads**, and takes an `ownerId` that comes from the request path (ADR-009);
 * its routes are mounted on a tree that refuses every write.
 *
 * The profile is deliberately thin — name, avatar, bio, and what has been played.
 * Decided with the maintainer on 2026-09-18: nothing goes on a profile for the sake of
 * filling it, and a duellist's decks are not what one looks a profile up for.
 *
 * Any signed-in duellist may read any profile but a blocked one. The collection
 * and the decks follow what their owner chose to show (M4, 2026-09-21). Both
 * questions are `social`'s single checkpoint (R3, `docs/04-structure.md`); this
 * module asks it, and never tests anything itself.
 */
import type { Database } from "../../db/client.js";
import { notFound } from "../../platform/errors.js";
import { requireUuid } from "../../platform/identifiers.js";
import {
  collectionFacets, collectionQuery, listCollection, type CollectionItem,
} from "../collection/index.js";
import {
  getDeck, listDecks, listFolders, type DeckDetail, type DeckFolder, type DeckSummary,
} from "../deck/index.js";
import { duelTally } from "../duel/index.js";
import { getProfile, type Profile } from "../identity/index.js";
import { canView, friendStatusWith, type FriendStatus, type ViewScope } from "../social/index.js";

export type PlayerProfile = {
  profile: Profile;
  /** Duels recorded, and how many of them were won. Counted, never invented. */
  duels: { played: number; won: number };
  /** Where the relation stands, as the viewer sees it. */
  friendStatus: FriendStatus;
  /**
   * The viewer owns what they are looking at — decided here, from the session,
   * never by the screen. The screen shows editing only when it is true; the
   * write routes refuse anyone else whatever the screen shows (ADR-009).
   */
  isOwner: boolean;
  /** What the viewer may open from here — the checkpoint's answers, not a guess. */
  sees: { collection: boolean; decks: boolean };
};

export async function getPlayerProfile(
  db: Database,
  viewerId: string,
  ownerId: string,
): Promise<PlayerProfile> {
  const profile = await getProfile(db, requireUuid(ownerId));
  // The single checkpoint (R3): a block hides the profile, and “not found” is
  // the answer a refused read gives — see ADR-009.
  if (!(await canView(db, viewerId, profile.id))) throw notFound("Player not found.");
  return {
    profile,
    duels: await duelTally(db, profile.id),
    friendStatus: await friendStatusWith(db, viewerId, profile.id),
    isOwner: viewerId === profile.id,
    sees: {
      collection: await canView(db, viewerId, profile.id, "collection"),
      decks: await canView(db, viewerId, profile.id, "decks"),
    },
  };
}

/**
 * The checkpoint, for one shelf. A refusal is “not found”, as for a profile:
 * saying “private” would confirm what is there to hide.
 */
async function requireView(db: Database, viewerId: string, ownerId: string, scope: ViewScope): Promise<string> {
  const id = requireUuid(ownerId);
  if (!(await canView(db, viewerId, id, scope))) throw notFound("Player not found.");
  return id;
}

/**
 * Someone's collection, as a visitor reads it — the owner's filters, and **no
 * notes**: a note is what one writes for oneself (“lent to Yugi”), not a
 * listing detail.
 */
export async function playerCollection(
  db: Database,
  viewerId: string,
  ownerId: string,
  query: Record<string, string>,
): Promise<{ items: CollectionItem[]; total: number }> {
  const id = await requireView(db, viewerId, ownerId, "collection");
  const page = await listCollection(db, id, collectionQuery(query));
  return { ...page, items: page.items.map((item) => ({ ...item, notes: null })) };
}

export async function playerCollectionFacets(db: Database, viewerId: string, ownerId: string) {
  return collectionFacets(db, await requireView(db, viewerId, ownerId, "collection"));
}

export async function playerDecks(
  db: Database,
  viewerId: string,
  ownerId: string,
): Promise<{ items: DeckSummary[]; folders: DeckFolder[] }> {
  const id = await requireView(db, viewerId, ownerId, "decks");
  const [items, folders] = await Promise.all([listDecks(db, id), listFolders(db, id)]);
  return { items, folders };
}

export async function getPlayerDeck(
  db: Database,
  viewerId: string,
  ownerId: string,
  deckId: string,
): Promise<DeckDetail> {
  return getDeck(db, await requireView(db, viewerId, ownerId, "decks"), deckId);
}
