/**
 * La bande dessinée et la bande lue doivent être la même.
 *
 * Le moteur OCR découpe une bande définie par `SCAN_ZOOM_BAND` ; la feuille de
 * style en dessine une autre, définie par `.scan-zoom-band`. Ce sont deux
 * écritures de la même chose, et rien dans le langage ne les relie.
 *
 * ATEM-old a vécu la panne : les pourcentages du CSS ont été inventés en
 * habillant des classes qui n'avaient pas de règle, la bande dessinée s'est
 * retrouvée en bas du viseur et la bande lue au milieu. On cadrait le set code
 * à un endroit, l'OCR regardait ailleurs, et le scan répondait « rien de
 * fiable » sans que rien n'explique pourquoi. Le module l'annonçait pourtant,
 * juste au-dessus de ses constantes — « doit correspondre au CSS » — et rien ne
 * le vérifiait.
 *
 * Maintenant si.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "apps", "web", "src");
const ENGINE = path.join(ROOT, "screens/collection/ocr/engine.ts");
const SHEET = path.join(ROOT, "design/components/scanner.css");

const engine = readFileSync(ENGINE, "utf8");
const sheet = readFileSync(SHEET, "utf8");

const engineBlock = engine.match(/export const SCAN_ZOOM_BAND\s*=\s*\{([^}]*)\}/);
if (!engineBlock) {
  console.error(`✗ SCAN_ZOOM_BAND introuvable dans ${path.relative(ROOT, ENGINE)}`);
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
  console.error(`✗ .scan-zoom-band introuvable dans ${path.relative(ROOT, SHEET)}`);
  process.exit(1);
}

const readPercent = (source, property) => {
  // On saute les commentaires : ils citent souvent les valeurs qu'ils expliquent.
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
    mismatches.push(`${NAMES[key]} : valeur illisible (moteur ${engineValue}, CSS ${cssValue})`);
    continue;
  }
  // Une tolérance d'un dixième de pourcent absorbe l'arrondi de l'écriture en
  // pourcentage, sans laisser passer un décalage visible.
  if (Math.abs(engineValue - cssValue) > 0.001) {
    mismatches.push(
      `${NAMES[key]} : moteur ${engineValue} (${(engineValue * 100).toFixed(1)} %) ` +
        `≠ CSS ${(cssValue * 100).toFixed(1)} %`,
    );
  }
}

if (mismatches.length > 0) {
  console.error("✗ la bande dessinée et la bande lue ne coïncident pas :\n");
  for (const line of mismatches) console.error(`    ${line}`);
  console.error(
    "\n  Le viseur montrerait au joueur une zone que l'OCR ne lit pas," +
      "\n  et le scan échouerait sans rien expliquer.",
  );
  process.exit(1);
}

console.log(
  `✓ bande de visée cohérente — ${(fromEngine.x * 100).toFixed(0)} % / ` +
    `${(fromEngine.y * 100).toFixed(0)} % · ${(fromEngine.w * 100).toFixed(0)} % × ` +
    `${(fromEngine.h * 100).toFixed(0)} %`,
);
