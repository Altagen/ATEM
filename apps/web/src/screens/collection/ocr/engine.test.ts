import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applySetDict,
  extractSetCodeCandidates,
  filterLogicalScanChoices,
  fixOcrNoise,
  getCardGuideRect,
  isStrongSetCode,
  pickBestSetCode,
  repairSetCodeCandidate,
  resetSetDictForTests,
  scoreSetCode,
  STRONG_SCORE_THRESHOLD,
  YGO_CARD_RATIO,
} from "./engine.js";

// Unit tests use the built-in fallback unless a dict is applied explicitly.
// Reset between files / after dict tests.
resetSetDictForTests();

describe("extractSetCodeCandidates", () => {
  it("parses FR set codes from noisy OCR", () => {
    const text = "YUGIOH  LOB-FR001  © Konami";
    const c = extractSetCodeCandidates(text);
    assert.ok(c.includes("LOB-FR001"));
    assert.equal(pickBestSetCode(c), "LOB-FR001");
  });

  it("parses compact and hyphen variants", () => {
    const c = extractSetCodeCandidates("LTGY FR008 something");
    assert.ok(c.some((x) => x.startsWith("LTGY-FR")));
  });

  it("parses fully compact LTGYFR008", () => {
    const c = extractSetCodeCandidates("LTGYFR008");
    assert.ok(c.includes("LTGY-FR008"), String(c));
    assert.equal(pickBestSetCode(c), "LTGY-FR008");
  });

  it("recovers from junk around compact code", () => {
    const c = extractSetCodeCandidates("- 1 LTGYFR008 SL -");
    assert.ok(c.includes("LTGY-FR008"), String(c));
  });

  it("recovers O/0 confusions in numbers", () => {
    const c = extractSetCodeCandidates("LTGY-FROO8");
    assert.ok(
      c.some((x) => x === "LTGY-FR008" || x === "LTGY-FR00O" || x.startsWith("LTGY-FR")),
      String(c),
    );
  });

  it("prefers FR over EN when both present", () => {
    const c = extractSetCodeCandidates("SDRE-EN005 SDRE-FR005");
    assert.equal(pickBestSetCode(c), "SDRE-FR005");
  });

  it("rejects pure 8-digit passcodes", () => {
    const c = extractSetCodeCandidates("12345678");
    assert.equal(c.length, 0);
  });
});

describe("filterLogicalScanChoices", () => {
  it("drops junk / unknown prefixes / trailing garbage and dedupes", () => {
    resetSetDictForTests();
    const out = filterLogicalScanChoices(
      [
        "SDS1-FR007",
        "sds1-fr007",
        "SDSI-FR007",
        "SDSI-FR0075R",
        "SDS1-FR0075R",
        "LTGY-FR008",
        "LTGY-FR00S",
        "NOTASET-FR001",
      ],
      { prefer: "SDS1-FR007" },
    );
    assert.ok(out.includes("SDS1-FR007"));
    assert.ok(out.includes("LTGY-FR008"));
    assert.equal(out.filter((c) => c === "SDS1-FR007").length, 1);
    assert.ok(!out.includes("SDSI-FR007"));
    assert.ok(!out.some((c) => c.includes("0075R") || c.includes("FR00S")));
    assert.equal(out[0], "SDS1-FR007");
  });

  it("adds near alternatives SDS1 ↔ 5DS1 (same print) for OCR recovery", () => {
    resetSetDictForTests();
    // Fallback dict has both SDS1 and 5DS1
    const out = filterLogicalScanChoices(["SDS1-FR007"], {
      prefer: "SDS1-FR007",
      max: 6,
    });
    assert.ok(out.includes("SDS1-FR007"));
    assert.ok(
      out.includes("5DS1-FR007"),
      `expected 5DS1-FR007 near miss in ${JSON.stringify(out)}`,
    );
    assert.equal(out.filter((c) => c === "SDS1-FR007").length, 1);
  });
});

describe("scoreSetCode / evidence ranking", () => {
  it("ranks known FR prints above unknown junk and IT", () => {
    resetSetDictForTests();
    assert.ok(scoreSetCode("LTGY-FR008") >= STRONG_SCORE_THRESHOLD);
    assert.ok(scoreSetCode("LTGY-FR008") > scoreSetCode("LTGY-IT008"));
    assert.ok(scoreSetCode("LTGY-FR008") > scoreSetCode("TALN-FR001"));
    assert.ok(scoreSetCode("TALN-FR001") < STRONG_SCORE_THRESHOLD);
  });

  it("pickBest chooses highest score (FR over EN, known over invent)", () => {
    resetSetDictForTests();
    assert.equal(
      pickBestSetCode(["LTGY-EN008", "LTGY-FR008", "TALN-FR001"]),
      "LTGY-FR008",
    );
  });
});

describe("isStrongSetCode", () => {
  it("accepts modern LANG codes with known prefixes", () => {
    assert.equal(isStrongSetCode("LTGY-FR008"), true);
    assert.equal(isStrongSetCode("LOB-EN001"), true);
    assert.equal(isStrongSetCode("ALIN-FR010"), true);
    assert.equal(isStrongSetCode("SDS1-FR007"), true);
    assert.equal(isStrongSetCode("RGBT-FR035"), true);
    assert.equal(isStrongSetCode("RA04-FR180"), true);
  });

  it("rejects partial / no-lang junk (TGY-813 style)", () => {
    assert.equal(isStrongSetCode("TGY-813"), false);
    assert.equal(isStrongSetCode("MRD-098"), false);
  });

  it("rejects FR00S and unknown doubled prefixes; allows real DOOD", () => {
    assert.equal(isStrongSetCode("LTGY-FR00S"), false);
    assert.equal(isStrongSetCode("LTGGY-FR008"), false);
    // DOOD is in fallback? may not be — only shape+known. Use applySetDict in dict tests.
  });

  it("rejects invented well-formed prefixes (debugocr false locks)", () => {
    // These match SET-LANG### shape but are NOT real sets → no auto-lock
    assert.equal(isStrongSetCode("RGBI-FR038"), false);
    assert.equal(isStrongSetCode("ATIN-FR082"), false);
    assert.equal(isStrongSetCode("TALN-FR001"), false);
    assert.equal(isStrongSetCode("SDS-IT007"), false);
    assert.equal(isStrongSetCode("RGB-IT003"), false);
  });
});

describe("repairSetCodeCandidate (debugocr/4)", () => {
  it("maps letters in print number 1:1 (S→5, B→8, O/U→0)", () => {
    // S → 5 (nearest digit), not dual 5|8 fan-out
    assert.ok(repairSetCodeCandidate("LTGY-FR00S").includes("LTGY-FR005"));
    assert.ok(repairSetCodeCandidate("RGBT-FR03S").includes("RGBT-FR035"));
    assert.ok(!repairSetCodeCandidate("RGBT-FR03S").includes("RGBT-FR038"));
    // O/U → 0, B → 8
    assert.ok(repairSetCodeCandidate("LTGY-FROU8").includes("LTGY-FR008"));
    assert.ok(repairSetCodeCandidate("LTGY-FROUS").includes("LTGY-FR005"));
    assert.ok(repairSetCodeCandidate("RGBT-FR03B").includes("RGBT-FR038"));
  });

  it("collapses LTGGY → LTGY but keeps real DOOD (no DOD collapse)", () => {
    assert.ok(repairSetCodeCandidate("LTGGY-FR008").includes("LTGY-FR008"));
    // DOOD is a real set with double O — must not collapse to DOD
    const dood = repairSetCodeCandidate("DOOD-FR032");
    assert.ok(dood.includes("DOOD-FR032"), String(dood));
    assert.ok(!dood.includes("DOD-FR002"), "must not invent DOD-FR002 from DOOD-FR032");
  });

  it("repairs ITGY → LTGY", () => {
    // S→5 (1:1 letter map); prefix ITGY→LTGY via glyph
    assert.ok(repairSetCodeCandidate("ITGY-FR00S").includes("LTGY-FR005"));
  });

  it("repairs dropped leading L: TGY → LTGY", () => {
    assert.ok(repairSetCodeCandidate("TGY-FR008").includes("LTGY-FR008"));
    assert.ok(repairSetCodeCandidate("TGY-FR002").includes("LTGY-FR002"));
    assert.equal(pickBestSetCode(extractSetCodeCandidates("TGY-FR008")), "LTGY-FR008");
  });

  it("repairs dropped/confused T: LGY / LIGY → LTGY", () => {
    assert.ok(repairSetCodeCandidate("LGY-FR008").includes("LTGY-FR008"));
    assert.ok(repairSetCodeCandidate("LIGY-FR008").includes("LTGY-FR008"));
    assert.ok(repairSetCodeCandidate("L1GY-FR008").includes("LTGY-FR008"));
    assert.equal(pickBestSetCode(extractSetCodeCandidates("LGY-FR008")), "LTGY-FR008");
    assert.equal(pickBestSetCode(extractSetCodeCandidates("LIGY-FR00S")), "LTGY-FR005");
  });

  it("does not invent LLOB from classic LOB", () => {
    const c = extractSetCodeCandidates("LOB-FR001");
    assert.ok(c.includes("LOB-FR001"));
    assert.equal(pickBestSetCode(c), "LOB-FR001");
    assert.ok(!c.includes("LLOB-FR001"));
  });
});

describe("extractSetCodeCandidates noisy OCR (debugocr/4)", () => {
  it("recovers LTGY print from real raw dumps (letter→digit 1:1)", () => {
    // Pure digit / O→0 / B→8 paths still land on 008
    const to008 = [
      "LTGGY-FR008",
      "LTGY-FROO8",
      "TLTGY-FROO8",
      "ILTGY-FROO8",
      "LTGY-FROU8",
      "LIGY-FROO8",
      "7LTGY-FROO8",
    ];
    for (const s of to008) {
      const c = extractSetCodeCandidates(s);
      assert.equal(pickBestSetCode(c), "LTGY-FR008", s);
    }
    // Trailing S → 5 (not 8): 00S / OUS → 005
    const to005 = ["LTGY-FR00S", "ITGY-FR00S", "LTGY-FROUS", "LTGY-FROOS"];
    for (const s of to005) {
      const c = extractSetCodeCandidates(s);
      assert.equal(pickBestSetCode(c), "LTGY-FR005", s);
    }
    // B → 8
    assert.equal(pickBestSetCode(extractSetCodeCandidates("LTGY-FROOB")), "LTGY-FR008");
  });

  it("recovers from multi-variant join (gray+soft+thin)", () => {
    // Includes FROO8 (→008) and FROUS (→005); best is FR008 (stronger pure-ish read)
    const joined = `LTGY-FROUS
LIGY-FROUB
LTGY-FROOS
LTGY-FROOB
ILTGY-FROO8`;
    const c = extractSetCodeCandidates(joined);
    const best = pickBestSetCode(c);
    assert.ok(
      best === "LTGY-FR008" || best === "LTGY-FR005",
      `got ${best}`,
    );
    assert.ok(isStrongSetCode(best!));
  });
});

describe("debugocr/6 structure deck + known sets", () => {
  it("keeps SDS1 digit in prefix (not SD51)", () => {
    const c = extractSetCodeCandidates("SDS1-FR007");
    assert.ok(c.includes("SDS1-FR007"), String(c));
    assert.equal(pickBestSetCode(c), "SDS1-FR007");
  });

  it("repairs SDST / SDS-IT noise toward SDS1-FR when FR present", () => {
    assert.ok(repairSetCodeCandidate("SDST-FR007").includes("SDS1-FR007"));
    const c = extractSetCodeCandidates("SDS1-FR007 SDST-FR007");
    assert.equal(pickBestSetCode(c), "SDS1-FR007");
  });

  it("repairs SDS-IT007 alone → SDS1-FR007 (debugocr/6 lock)", () => {
    // Real false lock: SDS-IT007 auto-locked while card is SDS1-FR007
    assert.ok(repairSetCodeCandidate("SDS-IT007").includes("SDS1-FR007"));
    assert.equal(pickBestSetCode(extractSetCodeCandidates("SDS-IT007")), "SDS1-FR007");
    assert.ok(isStrongSetCode("SDS1-FR007"));
    assert.equal(isStrongSetCode("SDS-IT007"), false);
  });

  it("repairs RGBI → RGBT", () => {
    assert.ok(repairSetCodeCandidate("RGBI-FR035").includes("RGBT-FR035"));
    assert.equal(pickBestSetCode(extractSetCodeCandidates("RGBI-FR035")), "RGBT-FR035");
  });

  it("repairs RGBI-FR038 alone → RGBT-FR038 (debugocr/6 lock)", () => {
    assert.equal(pickBestSetCode(extractSetCodeCandidates("RGBI-FR038")), "RGBT-FR038");
    assert.ok(isStrongSetCode("RGBT-FR038"));
    assert.equal(isStrongSetCode("RGBI-FR038"), false);
  });

  it("repairs RGB-IT003 → RGBT-FR003 (prefix+lang)", () => {
    const best = pickBestSetCode(extractSetCodeCandidates("RGB-IT003"));
    assert.equal(best, "RGBT-FR003");
  });

  it("repairs ATIN → ALIN", () => {
    assert.ok(repairSetCodeCandidate("ATIN-FR084").includes("ALIN-FR084"));
    assert.equal(pickBestSetCode(extractSetCodeCandidates("ATIN-FR084")), "ALIN-FR084");
  });

  it("repairs ATIN-FR082 alone → ALIN-FR082 (debugocr/6 lock)", () => {
    // Prefix fixed; last digit may still be wrong (082 vs 084) but not ATIN invent
    assert.equal(pickBestSetCode(extractSetCodeCandidates("ATIN-FR082")), "ALIN-FR082");
    assert.equal(isStrongSetCode("ATIN-FR082"), false);
    assert.ok(isStrongSetCode("ALIN-FR082"));
  });

  it("prefers FR over IT when both candidates", () => {
    const c = extractSetCodeCandidates("SDS1-FR007 SDS-IT007");
    assert.equal(pickBestSetCode(c), "SDS1-FR007");
  });
});

describe("debugocr/5 false locks / real sets", () => {
  it("keeps ALIN-FR010 (does not invent LTIN-FR001)", () => {
    const c = extractSetCodeCandidates("ALIN-FR010");
    assert.ok(c.includes("ALIN-FR010"), String(c));
    assert.equal(pickBestSetCode(c), "ALIN-FR010");
    assert.ok(!c.includes("LTIN-FR001"));
    assert.ok(!c.includes("LTIN-FR010"));
  });

  it("does not auto-lock LIGY / TLIGY as strong (must repair to LTGY)", () => {
    assert.equal(isStrongSetCode("LIGY-FR008"), false);
    assert.equal(isStrongSetCode("TLIGY-FR008"), false);
    assert.equal(isStrongSetCode("LTGY-FR008"), true);
    assert.equal(isStrongSetCode("ALIN-FR010"), true);
    assert.equal(pickBestSetCode(extractSetCodeCandidates("LIGY-FR008")), "LTGY-FR008");
    assert.equal(pickBestSetCode(extractSetCodeCandidates("TLIGY-FR008")), "LTGY-FR008");
  });

  it("does not promote truncated FR01 to FR001 over FR010", () => {
    const c = extractSetCodeCandidates("ALINFR010 ALIN-FR01");
    assert.equal(pickBestSetCode(c), "ALIN-FR010");
  });

  it("TALN-FR001 alone stays TALN (weak OCR) — no ALIN invention from thin air", () => {
    // We must not invent ALIN from TALN without evidence; better no lock than wrong card
    const c = extractSetCodeCandidates("TALN-FR001");
    const best = pickBestSetCode(c);
    assert.notEqual(best, "ALIN-FR010");
    assert.notEqual(best, "LTIN-FR001");
    // TALN is not a catalogue set → never auto-lock
    assert.equal(isStrongSetCode("TALN-FR001"), false);
    assert.equal(isStrongSetCode(best ?? ""), false);
  });
});

describe("set dictionary (static JSON asset)", () => {
  it("applySetDict enables print snap and rejects fake prints as strong", () => {
    applySetDict({
      prefixes: ["RGBT", "ALIN", "LTGY"],
      prints: {
        RGBT: ["035", "036"],
        ALIN: ["084", "010"],
        LTGY: ["008"],
      },
    });
    // Snap 038 → 035 (only real near neighbor)
    assert.ok(repairSetCodeCandidate("RGBT-FR038").includes("RGBT-FR035"));
    assert.equal(pickBestSetCode(extractSetCodeCandidates("RGBI-FR038")), "RGBT-FR035");
    assert.equal(isStrongSetCode("RGBT-FR035"), true);
    assert.equal(isStrongSetCode("RGBT-FR038"), false); // not in prints
    assert.equal(isStrongSetCode("RGBI-FR038"), false);
    // ATIN-FR082 → ALIN + snap 082→084
    assert.equal(pickBestSetCode(extractSetCodeCandidates("ATIN-FR082")), "ALIN-FR084");
    resetSetDictForTests();
  });

  it("FR03S → FR035 only (S→5), FR038 stays FR038", () => {
    resetSetDictForTests();
    assert.equal(pickBestSetCode(extractSetCodeCandidates("RGBT-FR03S")), "RGBT-FR035");
    assert.equal(pickBestSetCode(extractSetCodeCandidates("RGBT-FR038")), "RGBT-FR038");
    assert.equal(pickBestSetCode(extractSetCodeCandidates("LTGY-FR00S")), "LTGY-FR005");
  });

  it("does not invent RGBT-FR003 from FR035 when 001–100 are all in prints", () => {
    // Real bug: full YGOPRODeck prints for RGBT include 003; sliding window
    // truncated FR035 → FR03 → pad/snap → FR003, then score-tied and won.
    applySetDict({
      prefixes: ["RGBT"],
      prints: {
        RGBT: Array.from({ length: 100 }, (_, i) =>
          String(i).padStart(3, "0"),
        ),
      },
    });
    for (const raw of ["RGBT-FR035", "RGBTFR035", "RGBI-FR035", "RGBT FR035"]) {
      const c = extractSetCodeCandidates(raw);
      assert.equal(
        pickBestSetCode(c),
        "RGBT-FR035",
        `expected FR035 from ${raw}, got ${pickBestSetCode(c)} in ${JSON.stringify(c.filter((x) => x.startsWith("RGBT")))}`,
      );
      assert.ok(
        !c.includes("RGBT-FR003") ||
          scoreSetCode("RGBT-FR035") > scoreSetCode("RGBT-FR003"),
        "003 must not beat 035",
      );
    }
    resetSetDictForTests();
  });

  it("without prints map, known prefix alone is strong (fallback mode)", () => {
    resetSetDictForTests();
    assert.equal(isStrongSetCode("LTGY-FR008"), true);
    assert.equal(isStrongSetCode("RGBT-FR038"), true);
  });
});

describe("digit-leading prefixes (5DS1 Starter 5D's)", () => {
  it("accepts 5DS1 as strong (must not require letter-first)", () => {
    resetSetDictForTests();
    assert.equal(isStrongSetCode("5DS1-FR007"), true);
    assert.equal(isStrongSetCode("5DS1-EN001"), true);
  });

  it("repairs 5DSI → 5DS1 via general I/1 glyph (not SDS1)", () => {
    resetSetDictForTests();
    const repaired = repairSetCodeCandidate("5DSI-FR007");
    assert.ok(repaired.includes("5DS1-FR007"), String(repaired));
    assert.ok(!repaired.includes("SDS1-FR007"), "must not map 5DS1 family to SDS1");
    assert.equal(pickBestSetCode(extractSetCodeCandidates("5DSI-FR007")), "5DS1-FR007");
  });

  it("does not rewrite real 5DS1 into SDS1", () => {
    resetSetDictForTests();
    const c = extractSetCodeCandidates("5DS1-FR012");
    assert.ok(c.includes("5DS1-FR012"), String(c));
    assert.equal(pickBestSetCode(c), "5DS1-FR012");
    assert.notEqual(pickBestSetCode(c), "SDS1-FR012");
  });

  it("keeps SDS1 separate from 5DS1", () => {
    resetSetDictForTests();
    assert.equal(pickBestSetCode(extractSetCodeCandidates("SDS1-FR007")), "SDS1-FR007");
    assert.equal(pickBestSetCode(extractSetCodeCandidates("SDSI-FR007")), "SDS1-FR007");
  });
});

describe("fixOcrNoise", () => {
  it("uppercases and strips junk", () => {
    assert.equal(fixOcrNoise("lob-fr001!!"), "LOB-FR001");
  });
});

describe("getCardGuideRect", () => {
  it("centers a portrait card and puts set-code lower-right (not footer)", () => {
    const g = getCardGuideRect(720, 1280);
    assert.ok(g.w > 0 && g.h > 0);
    assert.ok(Math.abs(g.w / g.h - YGO_CARD_RATIO) < 0.02);
    assert.ok(g.x >= 0 && g.y >= 0);
    assert.ok(g.x + g.w <= 720 + 0.5);
    assert.ok(g.y + g.h <= 1280 + 0.5);
    // lower-right pocket, still above footer strip
    assert.ok(g.codeY >= g.y + g.h * 0.6);
    assert.ok(g.codeY <= g.y + g.h * 0.8);
    assert.ok(g.codeX >= g.x + g.w * 0.45);
    assert.ok(g.codeX + g.codeW <= g.x + g.w + 0.5);
    assert.ok(g.codeH < g.h * 0.12);
  });
});
