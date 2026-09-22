import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyToDraft, discardDraft, draftCopies, nameDraftLine, scanlistState, startDraft,
} from "./state.js";

/**
 * The rule that defines this screen.
 *
 * A scanlist's “−1” decrements **its** line, never the collection. The floor is
 * zero, the line stays visible there, and further “−1” do nothing at all —
 * certainly not remove a copy elsewhere. This is not a precaution added
 * afterwards: the batch does not leave the browser until it is saved, so there
 * is no path to the collection at all.
 */
test("the “−1” stops at zero and never goes below", () => {
  discardDraft();
  startDraft();

  applyToDraft("LTGY-FR008", 1);
  applyToDraft("LTGY-FR008", 1);
  const line = scanlistState().draft!.lines[0]!;
  assert.equal(line.quantity, 2, "deux scans, deux copies");

  applyToDraft("LTGY-FR008", -1);
  assert.equal(line.quantity, 1);

  applyToDraft("LTGY-FR008", -1);
  assert.equal(line.quantity, 0, "the floor is zero");

  applyToDraft("LTGY-FR008", -1);
  applyToDraft("LTGY-FR008", -1);
  assert.equal(line.quantity, 0, "and it does not go below");
});

test("a line that falls to zero stays displayed", () => {
  /**
   * It shows what was just cancelled. Making it disappear would look like a
   * mishandling — and would make the next “+1” longer, since it would require
   * scanning again.
   */
  discardDraft();
  startDraft();
  applyToDraft("LOB-FR001", 1);
  applyToDraft("LOB-FR001", -1);

  const lines = scanlistState().draft!.lines;
  assert.equal(lines.length, 1);
  assert.equal(lines[0]?.quantity, 0);
});

test("a “−1” on a code never scanned opens a line at zero", () => {
  // Not a line at −1, nor an error: the gesture simply has no effect.
  discardDraft();
  startDraft();
  applyToDraft("RA03-FR004", -1);

  assert.equal(scanlistState().draft!.lines[0]?.quantity, 0);
});

test("the most recently scanned moves to the top", () => {
  // It is the one the eye checks after pressing.
  discardDraft();
  startDraft();
  applyToDraft("AAAA-FR001", 1);
  applyToDraft("BBBB-FR001", 1);

  assert.deepEqual(
    scanlistState().draft!.lines.map((l) => l.setCode),
    ["BBBB-FR001", "AAAA-FR001"],
  );
});

test("the total counts copies, not references", () => {
  discardDraft();
  startDraft();
  applyToDraft("AAAA-FR001", 1);
  applyToDraft("AAAA-FR001", 1);
  applyToDraft("BBBB-FR001", 1);

  const draft = scanlistState().draft!;
  assert.equal(draft.lines.length, 2);
  assert.equal(draftCopies(draft), 3);
});

test("a name arriving late lands on the line", () => {
  /**
   * Adding does not wait for it: the line enters with its set code, which the
   * browser already holds. The name joins it if it arrives in time.
   */
  discardDraft();
  startDraft();
  applyToDraft("LTGY-FR008", 1);

  assert.equal(nameDraftLine("LTGY-FR008", "Grande Baleine", 12345678), true);
  const line = scanlistState().draft!.lines[0]!;
  assert.equal(line.name, "Grande Baleine");
  assert.equal(line.passcode, 12345678);
});

test("a name arriving after another does not overwrite it", () => {
  discardDraft();
  startDraft();
  applyToDraft("LTGY-FR008", 1);
  nameDraftLine("LTGY-FR008", "Grande Baleine", 12345678);

  assert.equal(nameDraftLine("LTGY-FR008", "Autre chose", 999), false);
  assert.equal(scanlistState().draft!.lines[0]?.name, "Grande Baleine");
});

test("a name for a vanished line resurrects nothing", () => {
  // The catalogue's answer may arrive after the batch has been discarded.
  discardDraft();
  assert.equal(nameDraftLine("LTGY-FR008", "Grande Baleine", 12345678), false);
  assert.equal(scanlistState().draft, null);
});
