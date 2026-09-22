/**
 * Writing a collection as CSV — the three formats, and how a cell is written.
 *
 * Taken from the earlier prototype, where the table of
 * formats already lived beside the column order, for the reason it gave: a
 * correct header over columns in the wrong order produces a file the other tool
 * reads wrongly without ever complaining.
 *
 * Measured against `docs/ref-csv-formats.md`, which is authoritative, the earlier prototype
 * had three defects this file does not carry over:
 * - **Cardmarket was written with commas.** The reference says real Cardmarket
 *   exports use `;`, and the earlier prototype even wrote that header with commas. Each format
 *   now carries its own separator, header included.
 * - **Cardmarket's languages stopped at French and English**, leaving the other
 *   ISO codes as they were. The reference asks for German, Spanish, Italian,
 *   Portuguese, Japanese and Korean too.
 * - **The BOM was added in the browser**, so a direct link to the export gave a
 *   file Excel in a French locale read as latin-1. That is the route's job now;
 *   this builder writes content only, which is also what a preview wants.
 */

export const CSV_EXPORT_FORMATS = [
  {
    id: "atem",
    label: "ATEM",
    filename: "collection.csv",
    separator: ",",
    // `set_code` first: it is the row's identity when the file is imported back.
    columns: ["set_code", "name", "quantity", "rarity", "language", "passcode", "notes"],
  },
  {
    id: "scanflip",
    label: "ScanFlip",
    filename: "scanflip_collection.csv",
    separator: ",",
    columns: ["Card Name", "Set Code", "Quantity", "Rarity", "Language", "Passcode", "Notes"],
  },
  {
    id: "cardmarket",
    label: "Cardmarket",
    filename: "cardmarket_collection.csv",
    separator: ";",
    // No passcode: Cardmarket identifies a card by its set number.
    columns: ["Card Name", "Card Number", "Quantity", "Rarity", "Language", "Comments"],
  },
] as const;

export type CsvExportFormat = (typeof CSV_EXPORT_FORMATS)[number]["id"];

export function isCsvExportFormat(value: string): value is CsvExportFormat {
  return CSV_EXPORT_FORMATS.some((format) => format.id === value);
}

/** What any of the three formats can write about one owned printing. */
export type CsvExportLine = {
  setCode: string;
  name: string | null;
  quantity: number;
  rarity: string | null;
  language: string | null;
  passcode: number | null;
  notes: string | null;
};

/**
 * Cardmarket spells languages out.
 *
 * An unknown code is written as it is rather than guessed: a wrong language on a
 * marketplace listing is worse than an unusual one.
 */
const CARDMARKET_LANGUAGES: Record<string, string> = {
  en: "English",
  fr: "French",
  de: "German",
  es: "Spanish",
  it: "Italian",
  pt: "Portuguese",
  ja: "Japanese",
  ko: "Korean",
};

/**
 * One cell.
 *
 * Quoted as soon as it holds a comma, **a semicolon**, a quote or a line break —
 * the semicolon even in a comma file, because a French spreadsheet reads it as a
 * separator. An inner quote is doubled. Nothing becomes the empty string.
 */
function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",;\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function row(format: CsvExportFormat, line: CsvExportLine): unknown[] {
  switch (format) {
    case "cardmarket":
      return [
        line.name,
        line.setCode,
        line.quantity,
        line.rarity,
        line.language ? (CARDMARKET_LANGUAGES[line.language] ?? line.language) : null,
        line.notes,
      ];
    case "scanflip":
      return [line.name, line.setCode, line.quantity, line.rarity, line.language, line.passcode, line.notes];
    case "atem":
      return [line.setCode, line.name, line.quantity, line.rarity, line.language, line.passcode, line.notes];
  }
}

/** The whole file, header included, ending with a line break. No BOM — see above. */
export function buildCollectionCsv(format: CsvExportFormat, lines: CsvExportLine[]): string {
  const spec = CSV_EXPORT_FORMATS.find((candidate) => candidate.id === format)!;
  const out = [spec.columns.join(spec.separator)];
  for (const line of lines) out.push(row(format, line).map(cell).join(spec.separator));
  return `${out.join("\n")}\n`;
}
