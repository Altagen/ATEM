import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DECK_FOLDER_MAX_DEPTH, folderCanHost, folderDepth, folderIsInside, folderSubtreeHeight,
  type FolderNode,
} from "./deck-folders.js";

/**
 * The folder tree, without a database.
 *
 * These functions serve both sides: the server refuses with them, the screen
 * greys out with them. Testing them here therefore tests them once for both.
 */

//  a
//  └ b
//    └ c
//  d
const tree: FolderNode[] = [
  { id: "a", parentId: null },
  { id: "b", parentId: "a" },
  { id: "c", parentId: "b" },
  { id: "d", parentId: null },
];

test("depth counts from the root, which is one", () => {
  assert.equal(folderDepth(tree, "a"), 1);
  assert.equal(folderDepth(tree, "b"), 2);
  assert.equal(folderDepth(tree, "c"), DECK_FOLDER_MAX_DEPTH);
  assert.equal(folderDepth(tree, null), 0, "the root is not a folder");
  assert.equal(folderDepth(tree, "unknown"), 0);
});

test("height counts what a folder carries", () => {
  assert.equal(folderSubtreeHeight(tree, "a"), 3);
  assert.equal(folderSubtreeHeight(tree, "b"), 2);
  assert.equal(folderSubtreeHeight(tree, "c"), 1, "a leaf occupies one level");
});

test("branch membership reads both ways", () => {
  assert.equal(folderIsInside(tree, "c", "a"), true);
  assert.equal(folderIsInside(tree, "a", "c"), false);
  assert.equal(folderIsInside(tree, "a", "a"), true, "a folder is inside its own");
  assert.equal(folderIsInside(tree, "d", "a"), false);
});

test("a folder is dropped neither into itself nor into one of its own", () => {
  assert.equal(folderCanHost(tree, "a", "a"), false);
  assert.equal(folderCanHost(tree, "a", "b"), false);
  assert.equal(folderCanHost(tree, "a", "c"), false);
});

test("the drop counts the subtree, not the folder alone", () => {
  // “b” carries “c”: two levels, dropped on “d” which sits on the first.
  assert.equal(folderCanHost(tree, "b", "d"), true, "1 + 2 fits in 3");
  // “a” carries three: nowhere but the root.
  assert.equal(folderCanHost(tree, "a", "d"), false, "1 + 3 goes past");
  assert.equal(folderCanHost(tree, "a", null), true, "the root always accepts");
});

test("a cycle in the database does not spin the walks forever", () => {
  /**
   * This service cannot create one, but a hand-written SQL statement could.
   * Without a guard the walk would never return: the server would freeze on a
   * request, the tab on a render.
   */
  const cycle: FolderNode[] = [
    { id: "x", parentId: "y" },
    { id: "y", parentId: "x" },
  ];
  assert.equal(folderDepth(cycle, "x"), 2, "it stops at the already-seen");
  assert.equal(folderIsInside(cycle, "x", "y"), true);
  assert.equal(folderSubtreeHeight(cycle, "x"), 2);
});
