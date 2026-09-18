/**
 * The player module — someone's profile, as another duellist sees it.
 *
 * It owns no table: it gathers what `identity` and `deck` expose. **It only
 * reads**, and takes an `ownerId` that comes from the request path (ADR-009);
 * its routes are mounted on a tree that refuses every write.
 *
 * Any signed-in duellist may read any profile, as ADR-009 settles for this
 * iteration. When blocking and visibility arrive, the check goes in `social`'s
 * single checkpoint (R3, `docs/05-structure.md`) and is called here.
 */
import type { Database } from "../../db/client.js";
import { notFound } from "../../platform/errors.js";
import { requireUuid } from "../../platform/identifiers.js";
import { listDecks } from "../deck/index.js";
import { duelTally } from "../duel/index.js";
import { getProfile, type Profile } from "../identity/index.js";
import { canView, friendStatusWith, type FriendStatus } from "../social/index.js";

/**
 * A deck, as a profile lists it: a name and its Main Deck size.
 *
 * The deck list's summary also carries what is missing from the owner's
 * collection, the folder, the cover — none of which the profile shows, so none
 * of which leaves the server.
 */
export type ProfileDeck = { id: string; name: string; main: number };

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
  decks: ProfileDeck[];
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
  const decks = await listDecks(db, profile.id);
  return {
    profile,
    duels: await duelTally(db, profile.id),
    friendStatus: await friendStatusWith(db, viewerId, profile.id),
    isOwner: viewerId === profile.id,
    decks: decks.map((deck) => ({ id: deck.id, name: deck.name, main: deck.counts.main })),
  };
}
