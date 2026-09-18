/**
 * The player module — someone's profile, as another duellist sees it.
 *
 * It owns no table: it gathers what `identity` and `deck` expose. **It only
 * reads**, and takes an `ownerId` that comes from the request path (ADR-009);
 * its routes are mounted on a tree that refuses every write.
 *
 * The profile is deliberately thin — name, avatar, bio, and what has been played.
 * Decided with Ange on 2026-09-18: nothing goes on a profile for the sake of
 * filling it, and a duellist's decks are not what one looks a profile up for.
 *
 * Any signed-in duellist may read any profile, as ADR-009 settles for this
 * iteration. When blocking and visibility arrive, the check goes in `social`'s
 * single checkpoint (R3, `docs/05-structure.md`) and is called here.
 */
import type { Database } from "../../db/client.js";
import { notFound } from "../../platform/errors.js";
import { requireUuid } from "../../platform/identifiers.js";
import { duelTally } from "../duel/index.js";
import { getProfile, type Profile } from "../identity/index.js";
import { canView, friendStatusWith, type FriendStatus } from "../social/index.js";

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
  };
}
