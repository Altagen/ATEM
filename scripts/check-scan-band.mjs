/**
 * The drawn band and the read band must be the same.
 *
 * The OCR engine crops a band defined by `SCAN_ZOOM_BAND`; the stylesheet draws
 * another, defined by `.scan-zoom-band`. They are two spellings of the same
 * thing, and nothing in the language links them.
 *
 * ATEM-old lived through the failure: the CSS percentages were invented while
 * styling classes that had no rule, the drawn band ended up at the bottom of the
 * viewfinder and the read band in the middle. You framed the set code in one
 * place, the OCR looked elsewhere, and the scan answered “nothing reliable”
 * with nothing explaining why. The module said so, though, right above its
 * constants — “Must match CSS .scan-zoom-band percentages” — and nothing
 * checked it.
 *
 * Now something does.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "apps", "web", "src");
const ENGINE = path.join(ROOT, "screens/collection/ocr/engine.ts");
const SHEET = path.join(ROOT, "design/components/scanner.css");

const engine = readFileSync(ENGINE, "utf8");
const sheet = readFileSync(SHEET, "utf8");

// `export` optional: the constant is read here as text, so it does not need to
// be part of the module's public surface — and on 2026-09-17 it stopped being
// so. A pattern that insists on a keyword it does not need turns a tidy-up into
// a failing gate.
const engineBlock = engine.match(/(?:export\s+)?const SCAN_ZOOM_BAND\s*=\s*\{([^}]*)\}/);
if (!engineBlock) {
  console.error(`✗ SCAN_ZOOM_BAND not found in ${path.relative(ROOT, ENGINE)}`);
  process.exit(1);
}

const readNumber = (source, key) => {
  const match = source.match(new RegExp(`${key}\\s*:\\s*([0-9.]+)`));
  return match ? Number(match[1]) : null;
};

const fromEngine = {
  x: readNumber(engineBlock[1], "x"),
  y: readNumber(engineBlock[1], "y"),
  w: readNumber(engineBlock[1], "w"),
  h: readNumber(engineBlock[1], "h"),
};

const cssBlock = sheet.match(/\.scan-zoom-band\s*\{([\s\S]*?)\}/);
if (!cssBlock) {
  console.error(`✗ .scan-zoom-band not found in ${path.relative(ROOT, SHEET)}`);
  process.exit(1);
}

const readPercent = (source, property) => {
  // Skip comments: they often quote the values they explain.
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, " ");
  const match = clean.match(new RegExp(`(?:^|;|\\s)${property}\\s*:\\s*([0-9.]+)%`));
  return match ? Number(match[1]) / 100 : null;
};

const fromCss = {
  x: readPercent(cssBlock[1], "left"),
  y: readPercent(cssBlock[1], "top"),
  w: readPercent(cssBlock[1], "width"),
  h: readPercent(cssBlock[1], "height"),
};

const NAMES = { x: "left / x", y: "top / y", w: "width / w", h: "height / h" };
const mismatches = [];

for (const key of ["x", "y", "w", "h"]) {
  const engineValue = fromEngine[key];
  const cssValue = fromCss[key];
  if (engineValue === null || cssValue === null) {
    mismatches.push(`${NAMES[key]}: unreadable value (engine ${engineValue}, CSS ${cssValue})`);
    continue;
  }
  // A tolerance of a tenth of a percent absorbs the rounding of the percentage
  // notation, without letting a visible offset through.
  if (Math.abs(engineValue - cssValue) > 0.001) {
    mismatches.push(
      `${NAMES[key]}: engine ${engineValue} (${(engineValue * 100).toFixed(1)}%) ` +
        `≠ CSS ${(cssValue * 100).toFixed(1)}%`,
    );
  }
}

if (mismatches.length > 0) {
  console.error("✗ the drawn band and the read band do not match:\n");
  for (const line of mismatches) console.error(`    ${line}`);
  console.error(
    "\n  The viewfinder would show the player an area the OCR does not read," +
      "\n  and the scan would fail without explaining anything.",
  );
  process.exit(1);
}

console.log(
  `✓ aiming band consistent — ${(fromEngine.x * 100).toFixed(0)}% / ` +
    `${(fromEngine.y * 100).toFixed(0)}% · ${(fromEngine.w * 100).toFixed(0)}% × ` +
    `${(fromEngine.h * 100).toFixed(0)}%`,
);
