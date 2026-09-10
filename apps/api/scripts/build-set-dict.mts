/**
 * Le catalogue de préfixes d'extension, pour l'OCR.
 *
 * La reconnaissance ne devine pas : elle compare ce qu'elle a lu à ce qui
 * existe. Un préfixe présent au catalogue vaut +100 au score de confiance, un
 * préfixe inconnu −80 — c'est ce qui sépare `LTGY-FR008` d'un `LTGV-FR0O8` mal
 * lu. Sans ce fichier, le moteur retombe sur une liste de secours d'environ
 * 120 sets, et la reconnaissance perd beaucoup.
 *
 * Le fichier est **dérivé** du catalogue en base, jamais écrit à la main : il
 * se régénère après chaque synchronisation, et ne peut donc pas dériver de ce
 * que le référentiel contient réellement.
 *
 * Usage : pnpm --filter @atem/api ocr:build-dict
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseSetCode } from "@atem/shared";
import { createDatabase } from "../src/db/client.js";
import { cardPrints } from "../src/modules/referential/schema.js";

const OUTPUT = resolve(
  import.meta.dirname,
  "../../web/public/ocr/set-prefixes.json",
);

const { db, sql } = createDatabase();

const rows = await db.select({ setCode: cardPrints.setCode }).from(cardPrints);

const prefixes = new Set<string>();
const prints = new Map<string, Set<string>>();

for (const row of rows) {
  const parts = parseSetCode(row.setCode);
  if (!parts) continue;
  prefixes.add(parts.prefix);

  // Le moteur ne retient que les numéros purement chiffrés, de 2 à 4 chiffres :
  // c'est sur eux qu'il autorise une correction à une lettre près. Les numéros
  // à préfixe alphabétique (`ENS10`) sont trop rares pour valoir ce risque.
  const digits = parts.number.replace(/\D/g, "");
  if (digits.length >= 2 && digits.length <= 4) {
    const bucket = prints.get(parts.prefix) ?? new Set<string>();
    bucket.add(digits);
    prints.set(parts.prefix, bucket);
  }
}

const dict = {
  prefixes: [...prefixes].sort(),
  prints: Object.fromEntries(
    [...prints].map(([prefix, numbers]) => [prefix, [...numbers].sort()]),
  ),
  generated_at: new Date().toISOString(),
  source: "catalogue local ATEM, dérivé de YGOPRODeck",
};

await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, JSON.stringify(dict));
await sql.end();

const numbers = [...prints.values()].reduce((sum, set) => sum + set.size, 0);
console.log(
  `[atem] ${dict.prefixes.length} préfixes et ${numbers} numéros écrits dans ${OUTPUT}`,
);
