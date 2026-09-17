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
import { requireUuid } from "../../platform/identifiers.js";
import { listDecks } from "../deck/index.js";
import { getProfile, type Profile } from "../identity/index.js";

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
  /** The viewer is looking at their own profile: the screen offers editing. */
  isSelf: boolean;
  decks: ProfileDeck[];
};

export async function getPlayerProfile(
  db: Database,
  viewerId: string,
  ownerId: string,
): Promise<PlayerProfile> {
  const profile = await getProfile(db, requireUuid(ownerId));
  const decks = await listDecks(db, profile.id);
  return {
    profile,
    isSelf: viewerId === profile.id,
    decks: decks.map((deck) => ({ id: deck.id, name: deck.name, main: deck.counts.main })),
  };
}
