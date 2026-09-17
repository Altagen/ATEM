/**
 * Reading a collection file — CSV from ATEM, ScanFlip or Cardmarket, or a JSON
 * scanlist export.
 *
 * `docs/ref-csv-formats.md` is authoritative, and this follows it rule by rule.
 * Taken from ATEM-old's `collection/csv.ts` — the alias table, the separator
 * detection, the language table — with its defects measured and left behind:
 *
 * - **It split the text into lines before reading quotes.** A cell holding a line
 *   break is quoted on export — a note written on two lines — so ATEM-old could
 *   not import its own export back as soon as a note had one. This reads the whole
 *   text with one state machine: a line break inside quotes is part of the cell.
 * - **Quantity had no upper bound**: `999999999` went through. The reference aligns
 *   it on the scanlists' bound, and a value above it is refused on that line rather
 *   than silently cut down, which would falsify the count.
 * - **A set code appearing twice was “last line wins”**, with no test. The
 *   reference settles it: quantities add up, the first name found is kept.
 */
import { LIMITS } from "./limits.js";
import { languageFromSetCode, normalizeSetCode } from "./set-code.js";

/** One row the file asks for, with the file line it came from. */
export type ImportRow = {
  line: number;
  setCode: string;
  name: string | null;
  quantity: number;
  rarity: string | null;
  language: string;
  passcode: number | null;
  notes: string | null;
};

/** A line that could not be read — reported, never fatal to the others. */
export type ImportLineError = { line: number; setCode?: string; error: string };

export type ParsedImport = { rows: ImportRow[]; errors: ImportLineError[] };

/**
 * Header aliases, as the reference lists them.
 *
 * The French variants are data, not decoration: they are what a French spreadsheet
 * writes.
 */
const ALIASES: Record<keyof Omit<ImportRow, "line">, string[]> = {
  setCode: [
    "set_code", "set code", "card number", "card_number", "number", "code", "set_id",
    "setid", "cardnumber", "expansion_code", "expansion code", "set_number", "expansion/set",
  ],
  name: ["name", "card_name", "card name", "title", "cardname", "card"],
  quantity: ["quantity", "qty", "count", "amount", "quantite", "quantité"],
  rarity: ["rarity", "print_rarity", "print rarity", "rarité", "rarite"],
  language: ["language", "lang", "langue"],
  passcode: ["passcode", "pass_code", "pass code", "card_id", "card id", "id", "ygoprodeck_id"],
  notes: ["notes", "note", "comment", "comments", "remark", "remarks", "condition"],
};

/**
 * Konami's numeric language codes, and the names people write.
 *
 * Unrecognised → its first two letters, lowercased (the reference's rule).
 */
const LANGUAGES: Record<string, string[]> = {
  en: ["en", "english", "anglais", "1"],
  fr: ["fr", "french", "français", "francais", "2"],
  de: ["de", "german", "allemand", "deutsch", "3"],
  es: ["es", "spanish", "espagnol", "español", "4"],
  it: ["it", "italian", "italien", "italiano", "5"],
  pt: ["pt", "portuguese", "portugais", "6"],
  ja: ["ja", "jp", "japanese", "japonais", "7"],
  ko: ["ko", "kr", "korean", "coréen", "coreen", "8"],
};

function normalizeLanguage(raw: string, setCode: string): string {
  const clean = raw.trim().toLowerCase();
  if (!clean) return languageFromSetCode(setCode);
  for (const [code, spellings] of Object.entries(LANGUAGES)) {
    if (spellings.includes(clean)) return code;
  }
  return clean.slice(0, 2);
}

/** `trim`, lowercase, then only `[a-z0-9_ ]` — the raw form is tried too. */
function columnFor(headers: string[], key: keyof typeof ALIASES): number {
  const aliases = ALIASES[key];
  return headers.findIndex((header) => {
    const raw = header.trim().toLowerCase();
    return aliases.includes(raw) || aliases.includes(raw.replace(/[^a-z0-9_ ]/g, ""));
  });
}

/**
 * The separator, decided once, on the header line.
 *
 * Commas and semicolons are counted **outside quotes**; more semicolons wins.
 */
function detectSeparator(text: string): "," | ";" {
  let quoted = false;
  let commas = 0;
  let semicolons = 0;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && (char === "\n" || char === "\r")) break;
    else if (!quoted && char === ",") commas += 1;
    else if (!quoted && char === ";") semicolons += 1;
  }
  return semicolons > commas ? ";" : ",";
}

/**
 * Records, with the file line each one starts on.
 *
 * One state machine over the whole text: a doubled quote is a quote, and neither
 * the separator nor a line break ends a quoted cell. Empty records are dropped.
 */
function records(text: string, separator: string): { line: number; cells: string[] }[] {
  const out: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let startLine = 1;

  const endRecord = () => {
    cells.push(cell);
    if (cells.some((value) => value.trim() !== "")) out.push({ line: startLine, cells });
    cells = [];
    cell = "";
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        if (char === "\n") line += 1;
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === separator) {
      cells.push(cell);
      cell = "";
    } else if (char === "\r") {
      // Swallowed: `\r\n` ends the record on its `\n`, a lone `\r` does nothing.
    } else if (char === "\n") {
      endRecord();
      line += 1;
      startLine = line;
    } else {
      cell += char;
    }
  }
  endRecord();
  return out;
}

/**
 * One candidate row, validated against the bounds the rest of the app keeps.
 *
 * Quantity: `1` when missing, non-numeric, zero or negative — silently, as the
 * reference says — but a value above the bound is an error on that line.
 */
function toRow(
  line: number,
  fields: { setCode: string; name?: string; quantity?: string; rarity?: string; language?: string; passcode?: string | number | null; notes?: string },
): ImportRow | ImportLineError {
  const trimmed = fields.setCode.trim().replace(/^#/, "");
  if (!trimmed) return { line, error: "empty_set_code" };
  const setCode = normalizeSetCode(trimmed);
  if (setCode.length > LIMITS.setCode.max) return { line, setCode, error: "set_code_too_long" };

  const rawQuantity = Number(String(fields.quantity ?? "").trim());
  const quantity = Number.isInteger(rawQuantity) && rawQuantity > 0 ? rawQuantity : 1;
  if (quantity > LIMITS.quantity.max) return { line, setCode, error: "quantity_too_large" };

  const rawPasscode = fields.passcode === null || fields.passcode === undefined
    ? NaN
    : Number(String(fields.passcode).trim());
  const passcode = Number.isInteger(rawPasscode) && rawPasscode > 0 ? rawPasscode : null;

  const notes = (fields.notes ?? "").trim() || null;
  if (notes && notes.length > LIMITS.note.max) return { line, setCode, error: "note_too_long" };

  return {
    line,
    setCode,
    name: (fields.name ?? "").trim() || null,
    quantity,
    rarity: (fields.rarity ?? "").trim() || null,
    language: normalizeLanguage(fields.language ?? "", setCode),
    passcode,
    notes,
  };
}

function parseCsv(text: string): ParsedImport {
  const separator = detectSeparator(text);
  const all = records(text, separator);
  const header = all[0];
  if (!header) return { rows: [], errors: [{ line: 1, error: "empty_file" }] };

  const at = {
    setCode: columnFor(header.cells, "setCode"),
    name: columnFor(header.cells, "name"),
    quantity: columnFor(header.cells, "quantity"),
    rarity: columnFor(header.cells, "rarity"),
    language: columnFor(header.cells, "language"),
    passcode: columnFor(header.cells, "passcode"),
    notes: columnFor(header.cells, "notes"),
  };
  // The only required column: without it no row can be identified.
  if (at.setCode < 0) return { rows: [], errors: [{ line: header.line, error: "missing_column_set_code" }] };

  const cellAt = (cells: string[], index: number) => (index >= 0 ? cells[index] : undefined);
  const candidates = all.slice(1).map((record) =>
    toRow(record.line, {
      setCode: cellAt(record.cells, at.setCode) ?? "",
      name: cellAt(record.cells, at.name),
      quantity: cellAt(record.cells, at.quantity),
      rarity: cellAt(record.cells, at.rarity),
      language: cellAt(record.cells, at.language),
      passcode: cellAt(record.cells, at.passcode),
      notes: cellAt(record.cells, at.notes),
    }),
  );
  return collect(candidates);
}

/**
 * A JSON scanlist export — both shapes the reference requires.
 *
 * ATEM-old's (`set_code`, `lignes`) and this application's own (`setCode`,
 * `lines`, a `null` passcode for an unidentified card); a bare array too, and the
 * `rows` envelope. Other keys are ignored without error.
 */
function parseJson(text: string): ParsedImport {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { rows: [], errors: [{ line: 1, error: "invalid_json" }] };
  }
  const envelope = data as { lignes?: unknown; rows?: unknown; lines?: unknown };
  const list = Array.isArray(data)
    ? data
    : Array.isArray(envelope?.lignes)
      ? envelope.lignes
      : Array.isArray(envelope?.rows)
        ? envelope.rows
        : Array.isArray(envelope?.lines)
          ? envelope.lines
          : null;
  if (!list) return { rows: [], errors: [{ line: 1, error: "expected_array_or_lignes" }] };

  const candidates = list.map((entry, index) => {
    const item = (entry ?? {}) as Record<string, unknown>;
    const text = (value: unknown) => (value === null || value === undefined ? undefined : String(value));
    return toRow(index + 1, {
      setCode: text(item.set_code ?? item.setCode) ?? "",
      name: text(item.name),
      quantity: text(item.quantity),
      rarity: text(item.rarity),
      language: text(item.language),
      passcode: (item.passcode as number | string | null | undefined) ?? null,
      notes: text(item.notes),
    });
  });
  return collect(candidates);
}

/**
 * Rows and errors apart, with duplicates merged.
 *
 * The same set code twice adds up its quantities and keeps the first name found —
 * the reference's decision, and what creating a scanlist already does. A sum above
 * the bound is refused like a single line above it.
 */
function collect(candidates: (ImportRow | ImportLineError)[]): ParsedImport {
  const errors: ImportLineError[] = [];
  const bySetCode = new Map<string, ImportRow>();
  // Once a code's sum went over the bound, its later lines are refused too —
  // otherwise a third occurrence would come back as if it were the first.
  const refused = new Set<string>();
  for (const candidate of candidates) {
    if ("error" in candidate) {
      errors.push(candidate);
      continue;
    }
    if (refused.has(candidate.setCode)) {
      errors.push({ line: candidate.line, setCode: candidate.setCode, error: "quantity_too_large" });
      continue;
    }
    const existing = bySetCode.get(candidate.setCode);
    if (!existing) {
      bySetCode.set(candidate.setCode, candidate);
      continue;
    }
    existing.quantity += candidate.quantity;
    existing.name ??= candidate.name;
    existing.passcode ??= candidate.passcode;
    existing.notes ??= candidate.notes;
    if (existing.quantity > LIMITS.quantity.max) {
      bySetCode.delete(candidate.setCode);
      refused.add(candidate.setCode);
      errors.push({ line: candidate.line, setCode: candidate.setCode, error: "quantity_too_large" });
    }
  }
  return { rows: [...bySetCode.values()], errors };
}

/**
 * Reads a collection file, whatever it is.
 *
 * JSON is recognised by its first non-blank character, `[` or `{`; anything else
 * is read as CSV. A leading BOM is removed either way.
 */
export function parseCollectionFile(raw: string): ParsedImport {
  const text = raw.replace(/^﻿/, "");
  const first = text.trimStart()[0];
  return first === "[" || first === "{" ? parseJson(text) : parseCsv(text);
}
