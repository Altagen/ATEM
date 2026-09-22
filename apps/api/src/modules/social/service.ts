/**
 * The social module — who knows whom, and who refuses whom.
 *
 * It owns `friend_edges` and `blocks`, and exposes the **single access
 * checkpoint** rule R3 of `docs/04-structure.md` asks for: `canView`. No
 * friendship or block test is written anywhere else — the earlier prototype had two
 * independent copies before other players' decks were even viewable.
 *
 * Taken from the earlier prototype: the ordered pair, the state
 * read from one side, blocking that severs the link in whatever state it was.
 */
import { and, eq, or } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { invalidInput, notFound } from "../../platform/errors.js";
import { requireUuid } from "../../platform/identifiers.js";
import { activePlayerId, listProfiles, visibilityOf, type Duellist } from "../identity/index.js";
import { notify, withdraw } from "../inbox/index.js";
import { blocks, friendEdges } from "./schema.js";

/**
 * Where a relation stands, **as one of the two sees it**.
 *
 * Not a boolean: the sender of a request needs to know it is waiting, and the
 * receiver needs to know it is theirs to answer. The earlier prototype shipped `isFriend`
 * alone at first, and a sent request looked exactly like no request at all.
 */
export type FriendStatus = "none" | "pending_sent" | "pending_received" | "friends";

/** A duellist as the directory lists them: their profile, and where we stand. */
export type DuellistCard = Duellist & { friendStatus: FriendStatus };

/**
 * How many the directory answers at once.
 *
 * The screen holds the whole list to count its chips, so this is also what it
 * renders. Beyond it the answer says so and the search narrows it down — an
 * instance with more duellists than this is not one where you scroll to find
 * someone.
 */
const DIRECTORY_LIMIT = 200;

/** The pair, in the order the `friend_edges_ordered` constraint imposes. */
const orderedPair = (x: string, y: string): [string, string] => (x < y ? [x, y] : [y, x]);

type Edge = typeof friendEdges.$inferSelect;

async function findEdge(db: Database, x: string, y: string): Promise<Edge | null> {
  const [a, b] = orderedPair(x, y);
  const [row] = await db
    .select()
    .from(friendEdges)
    .where(and(eq(friendEdges.userA, a), eq(friendEdges.userB, b)))
    .limit(1);
  return row ?? null;
}

function statusFor(edge: Edge | null, viewerId: string): FriendStatus {
  if (!edge) return "none";
  if (edge.status === "accepted") return "friends";
  return edge.requesterId === viewerId ? "pending_sent" : "pending_received";
}

/** Is there a block between these two, in either direction? */
async function blockedBetween(db: Database, x: string, y: string): Promise<boolean> {
  const [row] = await db
    .select({ id: blocks.id })
    .from(blocks)
    .where(or(
      and(eq(blocks.userId, x), eq(blocks.blockedUserId, y)),
      and(eq(blocks.userId, y), eq(blocks.blockedUserId, x)),
    ))
    .limit(1);
  return row !== undefined;
}

/** What someone may be looking at: the profile, or one of the two shelves. */
export type ViewScope = "profile" | "collection" | "decks";

/**
 * **The only place** that decides whether one person may read another's things.
 *
 * A block hides everything, in both directions. The profile is otherwise open
 * to any signed-in duellist (ADR-009); the collection and the decks follow
 * what their owner chose — everyone, friends, or nobody else (M4, 2026-09-21).
 * Every caller asks here and follows, without testing anything itself.
 */
export async function canView(
  db: Database,
  viewerId: string,
  ownerId: string,
  scope: ViewScope = "profile",
): Promise<boolean> {
  if (viewerId === ownerId) return true;
  if (await blockedBetween(db, viewerId, ownerId)) return false;
  if (scope === "profile") return true;
  const chosen = await visibilityOf(db, ownerId);
  if (!chosen) return false;
  const visibility = chosen[scope];
  if (visibility === "everyone") return true;
  if (visibility === "private") return false;
  return (await friendStatusWith(db, viewerId, ownerId)) === "friends";
}

/**
 * One's friends, all of them.
 *
 * Not the directory filtered on `friends`: the directory answers a bounded page
 * of everyone on the instance, so on a busy one a friend can simply not be in
 * it. Whoever needs “my friends” — the duel invitation, tomorrow the guild —
 * asks this, which is bounded by how many friends one has.
 */
export async function listFriends(db: Database, viewerId: string): Promise<Duellist[]> {
  const edges = await db
    .select()
    .from(friendEdges)
    .where(and(
      or(eq(friendEdges.userA, viewerId), eq(friendEdges.userB, viewerId)),
      eq(friendEdges.status, "accepted"),
    ));
  const ids = edges.map((edge) => (edge.userA === viewerId ? edge.userB : edge.userA));
  const friends = await listProfiles(db, { ids });
  return friends.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/** The relation as the viewer sees it, for a single person. */
export async function friendStatusWith(
  db: Database,
  viewerId: string,
  otherId: string,
): Promise<FriendStatus> {
  return statusFor(await findEdge(db, viewerId, otherId), viewerId);
}

/**
 * The duellists, everyone but the viewer and those either side has blocked.
 *
 * Friends first, then by name: the list is read to find someone you know.
 *
 * **No filter parameter.** The earlier prototype had `friends`, `online` and a third that
 * filtered the administrator role under a rank name the product does not have.
 * The screen writes the count on each of its chips, so it holds the whole list
 * whatever is selected, and filtering it again on the server would be a
 * parameter nothing needs to call.
 */
export async function listDuellists(
  db: Database,
  viewerId: string,
  options: { search?: string } = {},
): Promise<{ items: DuellistCard[]; truncated: boolean }> {
  const edges = await db
    .select()
    .from(friendEdges)
    .where(or(eq(friendEdges.userA, viewerId), eq(friendEdges.userB, viewerId)));
  const relation = new Map<string, FriendStatus>(
    edges.map((edge) => [
      edge.userA === viewerId ? edge.userB : edge.userA,
      statusFor(edge, viewerId),
    ]),
  );

  const blockRows = await db
    .select({ userId: blocks.userId, blockedUserId: blocks.blockedUserId })
    .from(blocks)
    .where(or(eq(blocks.userId, viewerId), eq(blocks.blockedUserId, viewerId)));
  const hidden = new Set(
    blockRows.map((row) => (row.userId === viewerId ? row.blockedUserId : row.userId)),
  );

  /**
   * The people one has a relation with come whatever the cut.
   *
   * The page is the first names in alphabetical order; friends and requests
   * used to be sorted to the top **after** it was cut, so on an instance past
   * two hundred duellists a friend named late in the alphabet never appeared —
   * nor in the “friends” chip, nor as a request to answer. Found on
   * 2026-09-22, reading this function while fixing a test.
   */
  const [related, page] = await Promise.all([
    listProfiles(db, { search: options.search, excludeId: viewerId, ids: [...relation.keys()] }),
    // One more than we keep: that is how we know the list was cut.
    listProfiles(db, { search: options.search, excludeId: viewerId, limit: DIRECTORY_LIMIT + 1 }),
  ]);
  const byId = new Map([...related, ...page].map((row) => [row.id, row]));
  const items = [...byId.values()]
    .filter((row) => !hidden.has(row.id))
    .map((row) => ({ ...row, friendStatus: relation.get(row.id) ?? "none" }));

  const sorted = items.sort((a, b) => {
    const mine = Number(b.friendStatus !== "none") - Number(a.friendStatus !== "none");
    const friends = Number(b.friendStatus === "friends") - Number(a.friendStatus === "friends");
    return friends !== 0 ? friends : mine !== 0 ? mine : a.displayName.localeCompare(b.displayName);
  });
  return {
    items: sorted.slice(0, DIRECTORY_LIMIT),
    truncated: page.length > DIRECTORY_LIMIT || sorted.length > DIRECTORY_LIMIT,
  };
}

/** The person a relation gesture targets — never suspended, never yourself. */
async function target(db: Database, viewerId: string, otherId: string): Promise<string> {
  const id = requireUuid(otherId);
  if (id === viewerId) throw invalidInput("A duellist cannot be their own friend.");
  const found = await activePlayerId(db, id);
  if (!found) throw notFound("Player not found.");
  return found;
}

/**
 * Asking someone to be friends — and accepting when they already asked.
 *
 * Two people who both asked have said the same thing twice: there is nothing
 * left to answer, so the crossing request is accepted on the spot (the earlier prototype's
 * decision, kept). Asking twice changes nothing: the pair is unique.
 */
export async function requestFriend(
  db: Database,
  viewerId: string,
  otherId: string,
): Promise<FriendStatus> {
  const id = await target(db, viewerId, otherId);
  if (await blockedBetween(db, viewerId, id)) throw notFound("Player not found.");

  const [a, b] = orderedPair(viewerId, id);
  const [row] = await db
    .insert(friendEdges)
    .values({ userA: a, userB: b, requesterId: viewerId })
    // The race is the same gesture from both sides at once: the unique pair
    // settles it, and the loser reads the row back instead of failing.
    .onConflictDoNothing()
    .returning();
  if (row) {
    await notify(db, { userId: id, kind: "friend_request", actorId: viewerId });
    return "pending_sent";
  }

  const existing = await findEdge(db, viewerId, id);
  if (!existing) throw notFound("Player not found.");
  if (existing.status === "accepted" || existing.requesterId === viewerId) {
    return statusFor(existing, viewerId);
  }

  await db
    .update(friendEdges)
    .set({ status: "accepted", respondedAt: new Date() })
    .where(eq(friendEdges.id, existing.id));
  // Their request is answered: the line offering to accept it has no purpose
  // left, and the other side learns it is done.
  await withdraw(db, { userId: viewerId, kind: "friend_request", actorId: id });
  await notify(db, { userId: id, kind: "friend_accepted", actorId: viewerId });
  return "friends";
}

/**
 * Accepting a request that is waiting for you.
 *
 * Only the one who did not send it may accept: otherwise anyone would befriend
 * anyone by sending a request and accepting it themselves.
 */
export async function acceptFriend(
  db: Database,
  viewerId: string,
  otherId: string,
): Promise<FriendStatus> {
  const id = await target(db, viewerId, otherId);
  const edge = await findEdge(db, viewerId, id);
  if (!edge || edge.status !== "pending" || edge.requesterId === viewerId) {
    throw notFound("No request to accept.");
  }
  await db
    .update(friendEdges)
    .set({ status: "accepted", respondedAt: new Date() })
    .where(eq(friendEdges.id, edge.id));
  await withdraw(db, { userId: viewerId, kind: "friend_request", actorId: id });
  await notify(db, { userId: id, kind: "friend_accepted", actorId: viewerId });
  return "friends";
}

/**
 * Removing a friend, refusing a request, cancelling your own: one gesture.
 *
 * All three end the same way — the row is gone and both are back to “Add”. A
 * refusal keeps nothing: there is nothing to keep, and a refused request left
 * in place is a request that can never be sent again.
 */
export async function removeFriend(
  db: Database,
  viewerId: string,
  otherId: string,
): Promise<FriendStatus> {
  const id = await target(db, viewerId, otherId);
  const [a, b] = orderedPair(viewerId, id);
  await db.delete(friendEdges).where(and(eq(friendEdges.userA, a), eq(friendEdges.userB, b)));
  // Whichever of the three gestures this was, no message may keep offering to
  // answer a request that is gone — in either inbox.
  await withdraw(db, { userId: id, kind: "friend_request", actorId: viewerId });
  await withdraw(db, { userId: viewerId, kind: "friend_request", actorId: id });
  return "none";
}

/**
 * Blocking someone severs the link, in whatever state it was.
 *
 * Otherwise you stay “friends” with someone you no longer see, or hold a
 * pending request you can neither accept nor refuse.
 */
export async function blockPlayer(db: Database, viewerId: string, otherId: string): Promise<void> {
  const id = await target(db, viewerId, otherId);
  await db.transaction(async (tx) => {
    await tx.insert(blocks).values({ userId: viewerId, blockedUserId: id }).onConflictDoNothing();
    const [a, b] = orderedPair(viewerId, id);
    await tx.delete(friendEdges).where(and(eq(friendEdges.userA, a), eq(friendEdges.userB, b)));
  });
  await withdraw(db, { userId: id, kind: "friend_request", actorId: viewerId });
  await withdraw(db, { userId: viewerId, kind: "friend_request", actorId: id });
}

export async function unblockPlayer(db: Database, viewerId: string, otherId: string): Promise<void> {
  const id = requireUuid(otherId);
  await db.delete(blocks).where(and(eq(blocks.userId, viewerId), eq(blocks.blockedUserId, id)));
}

/** Who this account has blocked — its own list, and the way back. */
export async function listBlocked(db: Database, viewerId: string): Promise<Duellist[]> {
  const rows = await db
    .select({ blockedUserId: blocks.blockedUserId })
    .from(blocks)
    .where(eq(blocks.userId, viewerId));
  const blocked = await listProfiles(db, { ids: rows.map((row) => row.blockedUserId) });
  return blocked.sort((a, b) => a.displayName.localeCompare(b.displayName));
}
