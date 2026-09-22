/**
 * Deck folders — filing, and nothing else.
 *
 * Nothing here knows about a card: a folder holds decks and other folders, that
 * is all. The separation comes from the earlier prototype, where it already held.
 *
 * **Three rules make up the whole subject**: the maximum depth, the absence of
 * cycles, and what happens to the contents of a folder being deleted. None of
 * the three can be expressed in a column constraint — they speak of a row's
 * whole path — so they live here, with their tests.
 *
 * **Reads take an owner, writes take a viewer** (ADR-009).
 */
import { and, eq } from "drizzle-orm";
import {
  DECK_FOLDER_MAX_DEPTH, folderDepth, folderIsInside, folderSubtreeHeight,
  type FolderNode,
} from "@atem/shared";
import type { Database } from "../../db/client.js";
import {
  conflict, invalidInput, notFound, violatesConstraint,
} from "../../platform/errors.js";
import { requireUuid } from "../../platform/identifiers.js";
import { deckFolders, decks, type DeckFolderRow } from "./schema.js";

export type DeckFolder = {
  id: string;
  parentId: string | null;
  name: string;
  /** The path from the root, its own name included — “Meta”, “Tier 1”. */
  path: string[];
  /** 1 at the root. What the limit counts. */
  depth: number;
  createdAt: string;
  updatedAt: string;
};

/**
 * Every folder of one person, in one go.
 *
 * The earlier prototype read the whole table again on every check — three times in a row for
 * a single creation. Since we need it whole to compute a path or a depth, we
 * read it **once** and everything else works in memory. A player has a few
 * dozen at most.
 */
async function loadFolders(db: Database, userId: string): Promise<Map<string, DeckFolderRow>> {
  const rows = await db.select().from(deckFolders).where(eq(deckFolders.userId, userId));
  return new Map(rows.map((row) => [row.id, row]));
}

/**
 * A folder's path, root first.
 *
 * The `seen` guard is not superstition: if a cycle entered the database by a
 * path other than this service, the walk up would spin forever and the request
 * would never return. A truncated path beats a stuck server.
 */
function pathOf(row: DeckFolderRow, byId: Map<string, DeckFolderRow>): string[] {
  const path: string[] = [];
  const seen = new Set<string>();
  let current: DeckFolderRow | undefined = row;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}

const toFolder = (row: DeckFolderRow, byId: Map<string, DeckFolderRow>): DeckFolder => {
  const path = pathOf(row, byId);
  return {
    id: row.id,
    parentId: row.parentId,
    name: row.name,
    path,
    depth: path.length,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
};

/**
 * The tree reduced to its topology, for the shared functions.
 *
 * They also serve the screen, which greys out what the server would refuse: one
 * implementation, two callers. That is the lesson of `checkDeckAdd`, which in
 * The earlier prototype greyed a button out while the server let requests through.
 */
const treeOf = (byId: Map<string, DeckFolderRow>): FolderNode[] =>
  [...byId.values()].map((row) => ({ id: row.id, parentId: row.parentId }));

const cleanName = (raw: string): string => {
  const clean = raw.trim();
  if (!clean) throw invalidInput("Give the folder a name.");
  return clean;
};

/**
 * The sibling-name conflict, made readable.
 *
 * Why `violatesConstraint` and never the message: see it in `platform/errors`.
 * The lesson came from the already-taken deck name, which surfaced as a 500.
 */
function explainConflict(err: unknown): never {
  if (violatesConstraint(err, "deck_folders_sibling_name_uidx")) {
    throw conflict("A folder by that name is already filed in the same place.");
  }
  throw err;
}

export async function listFolders(db: Database, ownerId: string): Promise<DeckFolder[]> {
  const byId = await loadFolders(db, ownerId);
  return [...byId.values()]
    .map((row) => toFolder(row, byId))
    .sort((a, b) => a.path.join("/").localeCompare(b.path.join("/"), "fr"));
}

/**
 * Does this folder really belong to this person?
 *
 * The deck module uses it before filing a deck: without this check, one could
 * drop a deck into a stranger's folder by guessing a UUID.
 */
export async function assertFolderOwned(
  db: Database,
  viewerId: string,
  folderId: string | null,
): Promise<void> {
  if (folderId === null) return;
  requireUuid(folderId);
  const [row] = await db
    .select({ id: deckFolders.id })
    .from(deckFolders)
    .where(and(eq(deckFolders.id, folderId), eq(deckFolders.userId, viewerId)))
    .limit(1);
  if (!row) throw notFound("Folder not found.");
}

export async function createFolder(
  db: Database,
  viewerId: string,
  input: { name: string; parentId?: string | null },
): Promise<DeckFolder> {
  const name = cleanName(input.name);
  const parentId = input.parentId ?? null;

  if (parentId !== null) {
    requireUuid(parentId);
    const byId = await loadFolders(db, viewerId);
    const parent = byId.get(parentId);
    if (!parent) throw notFound("Folder not found.");
    if (folderDepth(treeOf(byId), parent.id) >= DECK_FOLDER_MAX_DEPTH) {
      throw invalidInput("That folder is already on the last level.");
    }
  }

  try {
    const [row] = await db
      .insert(deckFolders)
      .values({ userId: viewerId, parentId, name })
      .returning();
    if (!row) throw new Error("insert returned nothing");
    return toFolder(row, await loadFolders(db, viewerId));
  } catch (err) {
    explainConflict(err);
  }
}

/**
 * Renaming a folder, or moving it.
 *
 * Both in the same gesture because the database writes them on the same row,
 * and because moving without renaming is a `parentId` without a `name`.
 *
 * **Moving is the hard part.** A folder cannot go under itself nor under one of
 * its descendants — the branch would vanish from the tree without anything
 * deleting it — and it takes its levels with it: it is the height of **its
 * subtree**, not the folder alone, that must fit under the limit.
 */
export async function updateFolder(
  db: Database,
  viewerId: string,
  folderId: string,
  input: { name?: string; parentId?: string | null },
): Promise<DeckFolder> {
  requireUuid(folderId);
  const byId = await loadFolders(db, viewerId);
  const existing = byId.get(folderId);
  if (!existing) throw notFound("Folder not found.");

  const values: { name?: string; parentId?: string | null; updatedAt: Date } = {
    updatedAt: new Date(),
  };
  if (input.name !== undefined) values.name = cleanName(input.name);

  if (input.parentId !== undefined) {
    const parentId = input.parentId;
    if (parentId === folderId) throw invalidInput("A folder cannot be filed inside itself.");

    if (parentId !== null) {
      requireUuid(parentId);
      if (!byId.has(parentId)) throw notFound("Folder not found.");

      /**
       * The three refusals are kept apart because each has its own sentence.
       * The question “does it fit?” has a single answer on the screen side
       * (`folderCanHost`); here we must say **why** not.
       */
      const tree = treeOf(byId);
      if (folderIsInside(tree, parentId, folderId)) {
        throw invalidInput("A folder cannot be filed inside one of its own.");
      }
      if (
        folderDepth(tree, parentId) + folderSubtreeHeight(tree, folderId) > DECK_FOLDER_MAX_DEPTH
      ) {
        throw invalidInput("That folder and its contents would go past the last level.");
      }
    }
    values.parentId = parentId;
  }

  try {
    const [row] = await db
      .update(deckFolders)
      .set(values)
      .where(and(eq(deckFolders.id, folderId), eq(deckFolders.userId, viewerId)))
      .returning();
    if (!row) throw notFound("Folder not found.");
    return toFolder(row, await loadFolders(db, viewerId));
  } catch (err) {
    explainConflict(err);
  }
}

/**
 * Deleting a folder **without deleting what it holds**.
 *
 * Its subfolders and its decks move up one level. That is the earlier prototype's rule, and
 * the right one: a folder is filing, not ownership — discarding it must not
 * carry away months of building. Its database said the opposite though
 * (`on delete cascade` on the parent), and the database is what would have won
 * had a deletion gone anywhere but through this service.
 *
 * The three writes hold in **one transaction**: half-done, it would leave decks
 * pointing at a folder that no longer exists.
 */
export async function deleteFolder(
  db: Database,
  viewerId: string,
  folderId: string,
): Promise<void> {
  requireUuid(folderId);
  const [existing] = await db
    .select()
    .from(deckFolders)
    .where(and(eq(deckFolders.id, folderId), eq(deckFolders.userId, viewerId)))
    .limit(1);
  if (!existing) throw notFound("Folder not found.");

  const parentId = existing.parentId;
  const now = new Date();

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(deckFolders)
        .set({ parentId, updatedAt: now })
        .where(and(eq(deckFolders.userId, viewerId), eq(deckFolders.parentId, folderId)));

      await tx
        .update(decks)
        .set({ folderId: parentId, updatedAt: now })
        .where(and(eq(decks.userId, viewerId), eq(decks.folderId, folderId)));

      await tx
        .delete(deckFolders)
        .where(and(eq(deckFolders.id, folderId), eq(deckFolders.userId, viewerId)));
    });
  } catch (err) {
    /**
     * A child moving up may collide with a namesake on the level above.
     *
     * We refuse rather than renaming on our own: the name belongs to whoever
     * wrote it, and two “Meta” side by side would be their surprise, not their
     * choice.
     */
    if (violatesConstraint(err, "deck_folders_sibling_name_uidx")) {
      throw conflict("A folder inside it has the same name as a folder on the level above.");
    }
    throw err;
  }
}
