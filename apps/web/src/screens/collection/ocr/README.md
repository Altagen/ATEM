# OCR set-code pipeline (ATEM Collection)

OCR is an **entry aid**, not an authority: it suggests a set code; the user confirms with **+1** (or edits / picks a chip).

## Layout in the repo

| Path | Role |
|------|------|
| `apps/web/src/collection/ocr.ts` | Browser OCR (Tesseract) + set-code parsing / ranking / chips |
| `apps/web/src/collection/ocr.test.ts` | Unit tests (noise, repairs, chips, scoring) |
| `apps/web/src/collection/app.ts` | Scan UI (green band, chips, text field, no auto-keyboard) |
| `apps/web/public/ocr/set-prefixes.json` | Live catalogue asset (prefixes + optional print numbers) |
| `scripts/ocr-lab/build-set-dict.py` | Regenerate the JSON from YGOPRODeck |
| `scripts/ocr-lab/analyze-prefix-confusions.py` | Offline glyph/levenshtein analysis (not runtime) |
| `scripts/ocr-lab/run-lab.py` | Local tesseract experiments on fixtures |

## Runtime flow

```
Camera → freeze frame → crop SCAN_ZOOM_BAND (CSS must match)
       → Tesseract (multi PSM / preprocess)
       → extractSetCodeCandidates(text)
       → pickBestSetCode / isStrongSetCode
       → UI review: green band + logical chips + editable field
       → user +1 → POST /collection (server may resolve async)
```

### UI contract (recovery-first)

- **Found something useful** → review mode: green band, chips, textbox visible, **no focus** (keyboard stays down).
- **Nothing reliable** → stay in live camera mode; status “Rien de fiable…”; user recaptures.
- **✎ / tap field** → keyboard on demand only.
- Chips = `filterLogicalScanChoices` (catalogue-backed near-misses only).

## Parsing & repair (logic layers)

1. **Noise** — `fixOcrNoise`, optional early letter→digit on number tails (`mapPrintLettersToDigits`).
2. **Extract** — regex / compact / sliding windows → raw candidates.
3. **Repair** — `repairSetCodeCandidate` / `prefixVariants` / `digitishVariants` / lang variants.
4. **Catalogue** — known prefixes (+ prints if loaded); no free Levenshtein invent.
5. **Rank** — `scoreSetCode` → `pickBestSetCode`.
6. **Chips** — `filterLogicalScanChoices` + glyph near-alts on **prefix only** (e.g. SDS1 ↔ 5DS1), same lang/print.

### Shared maps (single source in code)

- **Print letters → digits** (`PRINT_LETTER_TO_DIGIT`):  
  `O/U/D/Q→0 · I/L→1 · Z→2 · S→5 · G→6 · B→8` (1:1, no dual S→5|8).
- **Prefix glyphs** (`PREFIX_GLYPH_PAIRS`):  
  digit/letter confusions for set abbreviations only (≤2 subs when resolving).
- **Modern form helper** — `parseModernSetCode` / `normalizeSetCodeToken` used by strong / score / chips.

### Catalogue

- Prefer live JSON: `GET /ocr/set-prefixes.json` (Vite `public/`).
- Until loaded: `FALLBACK_SET_PREFIXES` (~120 common sets for tests / offline).
- Refresh asset anytime:

```bash
python3 scripts/ocr-lab/build-set-dict.py --full
# writes apps/web/public/ocr/set-prefixes.json — commit if you want it in git
```

## What is intentionally hard-coded

| Item | Why |
|------|-----|
| Glyph / digit maps | OCR confusion model (not a list of cards) |
| Score weights / `STRONG_SCORE_THRESHOLD` (140) | Ranking heuristics |
| Lang tags + IT→FR etc. | FR-first inventory |
| Collapse doubles only if prefix unknown | Stutter (LTGGY) without breaking DOOD |
| `SDS` / `SDST` → `SDS1` if known | Incomplete OCR tokens; SDS/SDST are not real sets |
| `SCAN_ZOOM_BAND` (+ CSS twin) | Crop geometry |
| Fallback prefix list | Boot / tests before JSON loads |

**Not hard-coded:** chip lists of set codes — generated from OCR result + glyph table + catalogue.

## What we deliberately do *not* do

- Silent auto-add to collection without user +1.
- Free Levenshtein “nearest set in whole catalogue” (false locks).
- FR↔EN as chip alternatives (not an OCR glyph of the print line).
- Global S→8 inventing 038 from 03S / 035.

## Server note (related, not in `ocr.ts`)

`POST /collection` accepts the set code quickly; catalogue resolve + image cache run in a background queue (`apps/api/src/modules/collection/resolve-queue.ts`) so the scan UX is not blocked on YGOPRODeck.

## Tests

```bash
pnpm --filter @atem/web test
```

Covers noise repair, DOOD vs collapse, SDS1↔5DS1 chips, strong/score, scan-choice filtering.
