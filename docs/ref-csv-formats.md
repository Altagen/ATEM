# Reference — collection import / export formats

Knowledge extracted from the earlier prototype, where it worked. This document is
authoritative: **it survives the rewrite even if all the code is thrown away.**

## Common rules

**Encoding** UTF-8. **BOM**: on export, the earlier prototype added it *client-side* — a direct
link to `/export.csv` therefore produced a file that Excel in a French locale reads
as latin-1, mangling the accents.
→ **ATEM decision: the BOM is written server-side.** On import, a leading BOM is
removed if present; the file is accepted with or without it.

**Line endings**: `\r?\n` accepted when reading (CRLF and LF). When writing, a final
`\n` after the last line. Empty lines are filtered out.

**Separator**: detected **once**, on the header line, by counting commas and
semicolons **outside quotes**. If there are more `;` than `,`, the whole file is read
with `;`. A single separator for the whole file.

**Escaping when writing**: a cell is wrapped in double quotes as soon as it contains
a comma, **a semicolon**, a quote, `\n` or `\r`. The semicolon is protected even in a
comma-separated file, because a French spreadsheet reads it as a separator. An inner
quote is doubled (`"` → `""`). `null` → empty string.

**Reading**: a state-machine parser handling doubled quotes and ignoring the
separator inside a quoted field.

## Column recognition

The header is normalised (`trim`, lowercase, then removal of everything except
`[a-z0-9_ ]`) before comparison. Alias table:

| Target column | Variants accepted in the header |
|---|---|
| `set_code` | `set_code`, `set code`, `card number`, `card_number`, `number`, `code`, `set_id`, `setid`, `cardnumber`, `expansion_code`, `expansion code`, `set_number`, `expansion/set` |
| `name` | `name`, `card_name`, `card name`, `title`, `cardname`, `card` |
| `quantity` | `quantity`, `qty`, `count`, `amount`, `quantite`, `quantité` |
| `rarity` | `rarity`, `print_rarity`, `print rarity`, `rarité`, `rarite` |
| `language` | `language`, `lang`, `langue` |
| `passcode` | `passcode`, `pass_code`, `pass code`, `card_id`, `card id`, `id`, `ygoprodeck_id` |
| `notes` | `notes`, `note`, `comment`, `comments`, `remark`, `remarks`, `condition` |

The French aliases (`quantité`, `rarité`, `langue`) are data: they are what French
spreadsheets write.

**Only `set_code` is required.** Its absence rejects the whole file
(`missing_column_set_code`).

## Value normalisation

**`set_code`**: `trim`, removal of a leading `#`, then uppercase and spaces → dash.

**`language`**: two-letter ISO code, full FR/EN name, or inherited **Konami numeric
code** — `1`=en, `2`=fr, `3`=de, `4`=es, `5`=it, `6`=pt, `7`=ja, `8`=ko. Missing or
empty column → language **inferred from the set code** (`LTGY-FR008` → `fr`).
Unrecognised value → first two characters, lowercased.

**`quantity`**: `1` by default if the column is missing, non-numeric, zero or
negative — silently, without a line error.
→ **ATEM decision**: add an **upper bound** (the earlier prototype had none, a CSV with
`quantity=999999999` went through). Aligned on the scanlists' bound: **1000**.

## The three formats

### ATEM (native)

```
set_code,name,quantity,rarity,language,passcode,notes
```
Separator `,` · file `collection.csv` · the only format with `set_code` first,
because it is the row's identity on re-import.

### ScanFlip (TCGplayer headers)

```
Card Name,Set Code,Quantity,Rarity,Language,Passcode,Notes
```
Separator `,` · file `scanflip_collection.csv` · language written as is.

### Cardmarket

```
Card Name;Card Number;Quantity;Rarity;Language;Comments
```
Separator **`;`** (real Cardmarket exports use it) · file
`cardmarket_collection.csv`.

- **No passcode column** — Cardmarket identifies by the set number.
- `set_code` → column `Card Number`; `notes` → column `Comments`.
- **Language spelled out**: `fr` → `French`, `en` → `English`. The earlier prototype only
  translated those two and left the others as ISO codes. → **To complete**: de, es,
  it, pt, ja, ko.

## JSON format (scanlist)

### The earlier prototype's format

```json
{
  "version": 1,
  "scanliste": "<batch name>",
  "date": "<creation date>",
  "lignes": [
    { "set_code": "SDRE-FR005", "name": "…", "quantity": 3, "passcode": 26976414 },
    { "set_code": "ZZZ-FR999", "name": "…", "quantity": 1 }
  ]
}
```

**`passcode` is omitted, never `null`, when the card is not identified — and it is an
integer, never a string.** Bug lived through: the first version emitted it as a
string, and every line was rejected by the server schema, silently.

The import detects JSON by itself (first non-blank character `[` or `{`), with no
format parameter. Accepted shapes: bare array, or an envelope `{lignes:[…]}`,
`{rows:[…]}` or `{lines:[…]}` — other keys are ignored without error. Any other shape →
`expected_array_or_lignes`. Invalid JSON → `invalid_json`.

### What ATEM exports today

The scanlist screen's “Export as JSON” (`SCANLIST_EXPORT_VERSION = 1`) writes
English keys, and **does not follow the rule above** for unidentified cards:

```json
{
  "version": 1,
  "name": "<batch name>",
  "createdAt": "<ISO date>",
  "pouredAt": "<ISO date or null>",
  "lines": [
    { "setCode": "SDRE-FR005", "name": "…", "passcode": 26976414, "quantity": 3 },
    { "setCode": "ZZZ-FR999", "name": null, "passcode": null, "quantity": 1 }
  ]
}
```

The import accepts both shapes — the earlier prototype's files, and this one — and treats a
`null` passcode as absent.

## Import modes

**`merge` does not add up.** It is the least intuitive point of the format.

- **`merge`** (default): the existing row's quantity is **aligned** on the file's
  (`delta = file − existing`), not added. Rows owned but absent from the file are
  kept intact. If only the note changes, only the note is written.
- **`replace`**: same treatment, then every owned row whose `set_code` does not
  appear in the file is **brought to zero**. The earlier prototype deleted it; a row at zero is
  kept for its note and favourite (R9, `docs/01-domain-model.md`), exactly as
  removing the last copy by hand does. Rows at zero are not exported. A **failed** file line **still counts as
  present** and spares the matching row — deliberate behaviour, to keep: a partly
  unreadable file must not cause a deletion.

**Per-line failures**: each line is processed independently. A failure adds an entry
to the report (`{line, set_code, error}`) without interrupting the following ones.
Returned summary: `mode`, `imported`, `removed`, `failed`, `errors[]`.

**History**: each import records its file name, mode and the three counts on the
server (`GET /collection/imports`, 50 newest). The earlier prototype kept it in the browser's
`localStorage`, lost with the browser and invisible from another device.

**Duplicate `set_code` in the same file**: The earlier prototype did “last line wins”, with no
test or specification, while scanlist creation merges.
→ **ATEM decision: merge**, adding up quantities and keeping the first identified
name.

**Maximum size**: 5 MB, checked **twice** — first on `Content-Length` to reject
early, then on the real size of the text read, because the header can lie or be
absent with `chunked`.

## Where it lives

- Export: `packages/shared/src/collection-csv.ts`, served by
  `GET /collection/export?format=atem|scanflip|cardmarket`.
- Import: `packages/shared/src/collection-import.ts` — the same parser runs in the
  browser for the preview and on the server for `POST /collection/import`.
- The round trip (export, erase, import, identical) is measured end to end in
  `e2e/settings.spec.ts`.
