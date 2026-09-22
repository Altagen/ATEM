/**
 * The topology of deck folders — depth, cycles, moves.
 *
 * **One implementation, two callers.** The server refuses, the screen greys
 * out: if each computed its own answer, we would fall back into the earlier prototype's
 * flaw, where `checkDeckAdd` served the display while the server let requests
 * through. Here both call the same functions.
 *
 * They know nothing but `{ id, parentId }`: no name, no date, no database row.
 * That is what makes them testable without a database.
 */

/**
 * How deep folders nest.
 *
 * Three levels, as in the earlier prototype. It is not a technical limit: past that you can
 * no longer find anything without remembering your own filing, and a
 * four-level breadcrumb no longer fits on a phone.
 */
export const DECK_FOLDER_MAX_DEPTH = 3;

export type FolderNode = { id: string; parentId: string | null };

/**
 * Walks up the chain of parents, stopping dead on a cycle.
 *
 * The guard is not superstition: if a cycle entered the database by a path that
 * does not go through the service, an unguarded walk would spin forever — on
 * the server the request would never return; on the screen the tab would
 * freeze.
 */
function* ancestry(nodes: FolderNode[], id: string): Generator<FolderNode> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const seen = new Set<string>();
  let current = byId.get(id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    yield current;
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
}

/** Which level is this folder on? 1 at the root, 0 when unknown. */
export function folderDepth(nodes: FolderNode[], id: string | null): number {
  if (id === null) return 0;
  let levels = 0;
  for (const _ of ancestry(nodes, id)) levels += 1;
  return levels;
}

/** How many levels does this folder occupy, itself included? 1 when empty. */
export function folderSubtreeHeight(nodes: FolderNode[], id: string): number {
  const children = nodes.filter((node) => node.parentId === id);
  if (children.length === 0) return 1;
  // The upward walk guards against cycles; here it is the descent we bound, by
  // never going back down into a folder already crossed.
  const seen = new Set<string>([id]);
  const heightFrom = (current: string): number => {
    const below = nodes.filter((node) => node.parentId === current && !seen.has(node.id));
    if (below.length === 0) return 1;
    for (const child of below) seen.add(child.id);
    return 1 + Math.max(...below.map((child) => heightFrom(child.id)));
  };
  return heightFrom(id);
}

/** Is `id` inside `ancestor`'s branch — or that ancestor itself? */
export function folderIsInside(nodes: FolderNode[], id: string, ancestor: string): boolean {
  for (const node of ancestry(nodes, id)) {
    if (node.id === ancestor) return true;
  }
  return false;
}

/**
 * Can this folder be dropped there?
 *
 * Three refusals: into itself, into one of its own — the branch would vanish
 * from the tree without anything deleting it — and past the last level, which
 * counts **what it carries** and not the folder alone.
 *
 * The root (`null`) always accepts: a subtree necessarily fits there, since it
 * already fitted somewhere.
 */
export function folderCanHost(
  nodes: FolderNode[],
  movingId: string,
  targetId: string | null,
): boolean {
  if (targetId === null) return true;
  if (targetId === movingId) return false;
  if (folderIsInside(nodes, targetId, movingId)) return false;
  return folderDepth(nodes, targetId) + folderSubtreeHeight(nodes, movingId) <= DECK_FOLDER_MAX_DEPTH;
}
