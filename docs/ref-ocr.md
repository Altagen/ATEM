# Reference — set code recognition (OCR)

**ATEM-old's most valuable asset.** These settings are the product of repeated
measurements, not a theoretical choice. Reproducing them from memory would cost
days.

## Engine

**tesseract.js 5.1.1**, **non-SIMD** LSTM variant — the SIMD variant crashes on some
mobile processors. Language `eng`, pack `@tesseract.js-data/eng` in
`4.0.0_best_int` (~2.9 MB compressed).

**It is not an npm dependency.** The engine is vendored: downloaded once from
jsDelivr, **checked by SHA-256 fingerprint**, then served from our own domain under
`/tesseract/*`.

The reason is not cosmetic: the session cookie is `httpOnly`, but a third-party
script loaded in the page could call the API on the user's behalf. Pinning a version
protects nothing — only the content's fingerprint counts.

```
tessedit_pageseg_mode  = "7"        // single line
tessedit_char_whitelist = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-"
load_system_dawg       = "0"        // no English dictionary
load_freq_dawg         = "0"        // a set code is not a word
```

Timeouts: 20 s to load the script, 45 s to create the worker and the language.

## Capture area

A fixed horizontal band, as a fraction of the camera frame:

```
SCAN_ZOOM_BAND = { x: 0.05, y: 0.34, w: 0.90, h: 0.30 }
```

**These coordinates are kept in sync with the CSS rule `.scan-zoom-band`.** A
mismatch between the two **breaks scanning silently**: the camera shows the player an
area the OCR does not read. `scripts/check-scan-band.mjs` compares them on every
`pnpm check` — ATEM-old had nothing checking it.

## Preprocessing — six treatments, tried in order

Each band is scaled to a target height of **88 px**, capped at 140 px high and
1100 px wide — beyond that, processing climbs to 10-15 s on mobile.

1. **`gray`** — greyscale + percentile contrast stretch, **no thresholding**.
   Measured: pure black and white makes `8`↔`S` and `0`↔`U` look alike. The LSTM
   reads grey better.
2. **`soft`** — partial thresholding (bias −12, dead zone ±18/22), keeps half-tones.
3. **`hard`** — Otsu, stroke thinning by 3×3 dilation, despeckling.
4. **`ink`** — threshold at the 22nd percentile: keeps only the darkest ink, which
   **preserves the holes of `0` and `8`**.
5. **Grey inversion** — the inverted-polarity case (light text on a dark background).
6. **Straightening at ±6° and ±12°** (four images). Measured on 3 September 2026: at
   5° of tilt reading fails completely, at 3° it still goes through. Hence those two
   steps.

## Recognition loop

Segmentation modes tried: `7` (single line), `8` (single word), `13` (raw line). In
standard capture, only `7` and `8` are tried on the first two variants — a fast
budget. In thorough mode (the dedicated scan screen), every variant × every mode.

**Early exit as soon as two independent readings agree** on the same strong code.
It prevents locking a false positive on a single noisy image.

## Correcting misreadings

**Normalisation**: `|` → `I`, filtering on the character whitelist.

**Letter → digit confusions, applied only to the card number, never to the set
prefix**:

```
O U D Q → 0     I L → 1     Z → 2     S → 5     G → 6     B → 8
```

Strict one-to-one mapping: no `S → 5 or 8`, which would reopen the ambiguity.

**Prefix catalogue** loaded from `/ocr/set-prefixes.json`, generated from the local
catalogue (`pnpm --filter @atem/api ocr:build-dict`), with a fallback of about 120
sets when it cannot be loaded.

**No free Levenshtein distance on prefixes** — explicitly refused, it produced locks
on the wrong set. Levenshtein ≤ 1 is only allowed on the **card number**, and only
against a closed set of known numbers.

## Confidence score

| Criterion | Points |
|---|---|
| Known set prefix | **+100** |
| Unknown prefix | **−80** |
| Card number present in the catalogue | **+80** |
| Known number but wrong | **−50** |
| `FR` region | +20 |
| `EN` region | +8 |
| `IT` region | −12 |
| 3-digit number | +15 |
| 4-digit number | −8 |
| 2-digit number | −15 |
| Character stutter (`LTGGY`) | penalty — but `DOOD` is spared, it is in the catalogue |

**Automatic lock threshold: 140** (`STRONG_SCORE_THRESHOLD`).

**Suggestions offered to the player**: only near-duplicates backed by the catalogue
(`SDS1` ↔ `5DS1`). **Never** an invented FR ↔ EN alternative.

## Usage contract — non-negotiable

**The OCR is never authoritative.** It proposes, the user confirms with “+1” or
corrects the field. No silent automatic addition to the collection.

## To be moved together, or it breaks silently

- `apps/web/src/screens/collection/ocr/engine.ts` (logic) and `ocr/README.md` (its
  documentation)
- `apps/web/src/screens/collection/scanner.ts` — **a single scanner** serves the
  Collection and the Scanlist
- `scripts/vendor-tesseract.sh` + `scripts/tesseract.sha256`
- `apps/web/public/ocr/set-prefixes.json` and the script generating it,
  `apps/api/scripts/build-set-dict.mts`
- `apps/web/src/design/components/scanner.css` — **the crop geometry depends on it**
