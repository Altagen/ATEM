import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestApp, freshEmail, freshSession, jsonRequest } from "../../test-support.js";
import { registerUser, deleteAccount } from "../identity/service.js";
import { createDeck, listDecks, updateDeck } from "./service.js";
import { createFolder, deleteFolder, listFolders, updateFolder } from "./folders.js";

const { app, db } = createTestApp();

/**
 * Deck folders.
 *
 * The earlier prototype had the right logic — depth, cycles, re-attaching — and **no test at
 * all**. That is exactly the kind of code nobody rereads and that comes undone
 * at the first refactor: three rules that speak of a tree, none of which fits
 * in a column constraint.
 */

async function newUser() {
  const { user } = await registerUser(db, {
    email: freshEmail("folder"),
    password: "Un-Mot-De-Passe-1!",
    displayName: "Filer",
  });
  return user;
}

test("a folder is created at the root, and carries its path", async () => {
  const user = await newUser();
  const meta = await createFolder(db, user.id, { name: "Meta" });

  assert.equal(meta.parentId, null);
  assert.deepEqual(meta.path, ["Meta"]);
  assert.equal(meta.depth, 1, "the root is the first level");

  const tier1 = await createFolder(db, user.id, { name: "Tier 1", parentId: meta.id });
  assert.deepEqual(tier1.path, ["Meta", "Tier 1"]);
  assert.equal(tier1.depth, 2);

  const all = await listFolders(db, user.id);
  assert.deepEqual(all.map((f) => f.path.join(" / ")), ["Meta", "Meta / Tier 1"]);
});

test("two folders with the same name are not filed side by side", async () => {
  /**
   * `nulls not distinct` is what makes the rule hold **at the root too**.
   * Without it, Postgres treats two null `parent_id` as different and one can
   * create two “Meta” at the root — where people create the most.
   */
  const user = await newUser();
  await createFolder(db, user.id, { name: "Duplicate" });
  await assert.rejects(
    () => createFolder(db, user.id, { name: "Duplicate" }),
    /already filed in the same place/,
  );

  // The same name elsewhere stays allowed: it is a different path.
  const elsewhere = await createFolder(db, user.id, { name: "Elsewhere" });
  const inside = await createFolder(db, user.id, { name: "Duplicate", parentId: elsewhere.id });
  assert.deepEqual(inside.path, ["Elsewhere", "Duplicate"]);
});

test("nesting does not go past the last level", async () => {
  const user = await newUser();
  const one = await createFolder(db, user.id, { name: "One" });
  const two = await createFolder(db, user.id, { name: "Two", parentId: one.id });
  const three = await createFolder(db, user.id, { name: "Three", parentId: two.id });
  assert.equal(three.depth, 3);

  await assert.rejects(
    () => createFolder(db, user.id, { name: "Four", parentId: three.id }),
    /last level/,
  );
});

test("a folder is filed neither inside itself, nor inside one of its own", async () => {
  /**
   * The case that loses a branch without deleting anything: the subtree moved
   * under its own descendant is no longer reachable from the root, and all that
   * is left is a cycle no upward walk ever leaves.
   */
  const user = await newUser();
  const parent = await createFolder(db, user.id, { name: "Parent" });
  const child = await createFolder(db, user.id, { name: "Child", parentId: parent.id });

  await assert.rejects(
    () => updateFolder(db, user.id, parent.id, { parentId: parent.id }),
    /inside itself/,
  );
  await assert.rejects(
    () => updateFolder(db, user.id, parent.id, { parentId: child.id }),
    /inside one of its own/,
  );
});

test("a moved folder takes its levels with it", async () => {
  /**
   * The naive check looks at the depth of the folder being moved. What counts
   * is the height of **its subtree**: a one-level folder carrying a second
   * occupies two where it lands.
   */
  const user = await newUser();
  const host = await createFolder(db, user.id, { name: "Host" });
  const subHost = await createFolder(db, user.id, { name: "Sub-host", parentId: host.id });

  const carrier = await createFolder(db, user.id, { name: "Carrier" });
  await createFolder(db, user.id, { name: "Carried", parentId: carrier.id });

  // Two levels dropped on a folder sitting on the second: that would make four.
  await assert.rejects(
    () => updateFolder(db, user.id, carrier.id, { parentId: subHost.id }),
    /go past the last level/,
  );

  // One level higher, it just fits.
  const moved = await updateFolder(db, user.id, carrier.id, { parentId: host.id });
  assert.deepEqual(moved.path, ["Host", "Carrier"]);
});

test("deleting a folder moves its contents up, losing nothing", async () => {
  /**
   * The earlier prototype's rule, and the right one — but its database said the opposite:
   * the `parent_id` cascaded while its service re-attached. Two contradictory
   * answers, and the database is what wins as soon as a deletion goes
   * elsewhere. Here the database answers nothing, the transaction does
   * everything.
   */
  const user = await newUser();
  const big = await createFolder(db, user.id, { name: "Big" });
  const middle = await createFolder(db, user.id, { name: "Middle", parentId: big.id });
  const small = await createFolder(db, user.id, { name: "Small", parentId: middle.id });

  const deck = await createDeck(db, user.id, "Filed in the middle");
  await updateDeck(db, user.id, deck.id, { folderId: middle.id });

  await deleteFolder(db, user.id, middle.id);

  const left = await listFolders(db, user.id);
  assert.deepEqual(
    left.map((f) => f.path.join(" / ")).sort(),
    ["Big", "Big / Small"],
    "the subfolder moved up one level",
  );

  const [summary] = await listDecks(db, user.id);
  assert.equal(summary?.folderId, big.id, "so did the deck, and it still exists");
  assert.equal(left.find((f) => f.id === small.id)?.parentId, big.id);
});

test("deleting a root folder puts its contents back at the root", async () => {
  const user = await newUser();
  const root = await createFolder(db, user.id, { name: "To discard" });
  const inside = await createFolder(db, user.id, { name: "Inside", parentId: root.id });
  const deck = await createDeck(db, user.id, "Soon folderless");
  await updateDeck(db, user.id, deck.id, { folderId: root.id });

  await deleteFolder(db, user.id, root.id);

  const left = await listFolders(db, user.id);
  assert.equal(left.find((f) => f.id === inside.id)?.parentId, null);
  assert.equal((await listDecks(db, user.id))[0]?.folderId, null);
});

test("a child moving up onto a namesake makes the deletion refuse", async () => {
  /**
   * We do not rename on our own: the name belongs to whoever wrote it, and two
   * “Tier 1” side by side would be their surprise, not their choice.
   */
  const user = await newUser();
  const top = await createFolder(db, user.id, { name: "Top" });
  const middle = await createFolder(db, user.id, { name: "Middle", parentId: top.id });
  await createFolder(db, user.id, { name: "Twin", parentId: top.id });
  await createFolder(db, user.id, { name: "Twin", parentId: middle.id });

  await assert.rejects(() => deleteFolder(db, user.id, middle.id), /on the level above/);
  // And nothing moved: the transaction rolled back.
  assert.equal((await listFolders(db, user.id)).length, 4);
});

test("someone else's folder is not found, rather than forbidden", async () => {
  // A 403 would say it exists. The filter is in the query.
  const me = await newUser();
  const other = await newUser();
  const theirs = await createFolder(db, other.id, { name: "Theirs" });

  await assert.rejects(() => updateFolder(db, me.id, theirs.id, { name: "Stolen" }), /not found/);
  await assert.rejects(() => deleteFolder(db, me.id, theirs.id), /not found/);

  const deck = await createDeck(db, me.id, "My deck");
  await assert.rejects(
    () => updateDeck(db, me.id, deck.id, { folderId: theirs.id }),
    /not found/,
    "one does not drop a deck into a stranger's folder by guessing a UUID",
  );
});

test("an identifier that is not a UUID is refused, not crashed on", async () => {
  const user = await newUser();
  await assert.rejects(
    () => updateFolder(db, user.id, "not-a-uuid", { name: "x" }),
    /Invalid identifier/,
  );
  await assert.rejects(() => deleteFolder(db, user.id, "../../etc"), /Invalid identifier/);
});

test("deleting your account takes your folders with it", async () => {
  /**
   * The `parent_id` does not cascade — that is intended — and it must not block
   * the account deletion either, which removes the whole branch at once. The
   * constraint is checked at the end of the statement: this test proves it.
   */
  const user = await newUser();
  const top = await createFolder(db, user.id, { name: "Top" });
  const bottom = await createFolder(db, user.id, { name: "Bottom", parentId: top.id });
  await createFolder(db, user.id, { name: "Lower still", parentId: bottom.id });

  await deleteAccount(db, user.id, "Un-Mot-De-Passe-1!");
  assert.equal((await listFolders(db, user.id)).length, 0);
});

test("the folder list comes before a deck's", async () => {
  /**
   * Hono tries routes in declaration order: `/decks/folders` declared after
   * `/decks/:id` would be swallowed, and would answer “invalid identifier” for
   * a folder list. A few lines moved are enough to undo it, without breaking
   * anything else — so we hold it here.
   */
  const { cookie } = await freshSession(app, "routes-folders");
  const response = await jsonRequest(app, "GET", "/decks/folders", undefined, { cookie });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { items: [] });
});

test("folders are created, renamed and discarded through the route", async () => {
  const { cookie } = await freshSession(app, "routes-crud");

  const created = await jsonRequest(
    app, "POST", "/decks/folders", { name: "Through the route" }, { cookie },
  );
  assert.equal(created.status, 201);
  const folder = (await created.json()) as { id: string; name: string };
  assert.equal(folder.name, "Through the route");

  const renamed = await jsonRequest(
    app, "PATCH", `/decks/folders/${folder.id}`, { name: "Renamed" }, { cookie },
  );
  assert.equal(renamed.status, 200);
  assert.equal(((await renamed.json()) as { name: string }).name, "Renamed");

  const discarded = await jsonRequest(
    app, "DELETE", `/decks/folders/${folder.id}`, undefined, { cookie },
  );
  assert.equal(discarded.status, 200);

  const list = await jsonRequest(app, "GET", "/decks/folders", undefined, { cookie });
  assert.deepEqual(await list.json(), { items: [] });
});
