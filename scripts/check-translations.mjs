/**
 * Nothing visible may escape the dictionary.
 *
 * Three defects, three refusals:
 *
 * — **A displayed string outside `t()`.** It will stay in English for a French
 *   account, with nothing reporting it. It is the defect that only shows when
 *   switching language, so never.
 *
 * — **A translated string with no French entry.** `t()` then falls back to the
 *   English key: the screen is half translated, which is worse than a screen
 *   that is not translated at all.
 *
 * — **A dictionary entry nothing uses any more.** It is the classic objection
 *   to phrase-as-key: changing the sentence would orphan its translation in
 *   silence. Here it fails the build, and the old entry shows — you know what to
 *   take back.
 *
 * Usage:
 *   node scripts/check-translations.mjs           # gate
 *   node scripts/check-translations.mjs --list    # the details, to work from
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const WEB = path.join(ROOT, "apps/web/src");
const API = path.join(ROOT, "apps/api/src");
const DICTIONARY = path.join(WEB, "platform/i18n/fr.ts");

/**
 * What the check does not look at.
 *
 * The OCR engine is taken as is from the earlier prototype and displays nothing: its strings
 * are log labels. The dictionaries are the place where French is allowed to be
 * data.
 */
const EXCLUDED = [
  "screens/collection/ocr/",
  "platform/i18n/",
  "platform/ygo-labels.ts",
];

const IGNORED_DIRS = new Set(["node_modules", "dist"]);

function files(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (IGNORED_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) files(full, acc);
    else if (full.endsWith(".ts") && !full.endsWith(".test.ts")) acc.push(full);
  }
  return acc;
}

/**
 * Removes comments **without moving lines**.
 *
 * Replacing them with a space collapsed the line breaks, and every line number
 * reported afterwards was off by that much — all the more off as the file was
 * commented, that is, everywhere here. So we give back as many line breaks as
 * the comment contained.
 */
const blankOut = (block) => block.replace(/[^\n]/g, " ");

const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, blankOut)
    .replace(/^\s*\/\/.*$/gm, "")
    // `<!-- … -->` explains the markup to whoever reads it, not to whoever sees it.
    .replace(/<!--[\s\S]*?-->/g, blankOut);

/**
 * What is visible, and what is not.
 *
 * Two rules, not a single heuristic:
 *
 * — **Markup text and the attributes that display** — `title`, `aria-label`,
 *   `placeholder`, `alt` — are visible **by nature**. Translation is required as
 *   soon as they carry a letter. The first version looked for what “looked
 *   French”, and let through “Scanner”, “Compact”, “Croissant”, “Ajouter au
 *   lot”: four clearly visible labels, too short or too unaccented to be
 *   recognised.
 *
 * — **Ordinary strings in the code** — arguments of `toast`, of `el`, of an
 *   `Error` — are mostly technical. There, only what looks like a sentence is
 *   required: see `PHRASE`.
 */
const LETTERS = /\p{L}{2}/u;
/**
 * A displayed sentence starts with a capital letter and contains a space.
 *
 * The previous rule looked for accents or French function words — it lost its
 * purpose once the source became English (2026-09-14). This one depends on no
 * language: “Deck not found.” is a sentence, `text/plain`, `POST` and
 * `deck-tile` are not.
 */
const PHRASE = /^\p{Lu}[^]*\s/u;
/**
 * What looks like code is not a sentence.
 *
 * The `>text<` sweep runs over the whole file: between the angle bracket of one
 * tag and that of another, it sometimes picks up whole lines of TypeScript — a
 * semicolon, a backtick or a double quote is enough to recognise them, and none
 * appears in displayed text. A `${` surviving the clean-up says the same: the
 * cut was wrong, it is not text.
 */
const CODE = /[;`"=]|\$\{/;

/**
 * An SVG path is not a sentence.
 *
 * `M12 2l4 8 8 1-6 5 2 8-8-4-8 4 2-8-6-5 8-1z` starts with a capital letter and
 * contains spaces: the “capital then space” rule took it for text. A path only
 * has commands and numbers.
 */
const SVG_PATH = /^[MmLlHhVvCcSsQqTtAaZz][\d\s.,-]*[MmLlHhVvCcSsQqTtAaZz\d\s.,-]*$/;

/**
 * Markup: any run of letters counts.
 *
 * Except a type annotation — `Record<string, string>(tag: K, attrs: Record<`
 * produces a fake node between two generic angle brackets. Two words separated
 * by a colon do not appear in displayed text.
 */
const ANNOTATION = /[\w)\]]\s*:\s*\w/;

/**
 * A class list is not a sentence.
 *
 * `"deck-stepper item-actions"` chosen by a ternary inside a `class` attribute:
 * only lowercase letters and dashes, never a capital or punctuation. No
 * displayed text looks like that.
 */
const CLASSES = /^[a-z0-9 -]+$/;

/**
 * A decorative non-Latin glyph is not to be translated.
 *
 * A deck's default thumbnail carries “遊戯王” — the game's name in Japanese,
 * which stays the same in every language. Asking for its translation would be
 * asking to translate a logo.
 */
const LATIN = /\p{Script=Latin}/u;

const isMarkupText = (text) =>
  !CODE.test(text) &&
  !ANNOTATION.test(text) &&
  !(CLASSES.test(text.trim()) && text.includes("-")) &&
  LATIN.test(text) &&
  LETTERS.test(text.trim());

/** Ordinary code: only what looks like a sentence is required. */
const isVisible = (text) =>
  text.trim().length >= 4 &&
  !CODE.test(text) &&
  !SVG_PATH.test(text.trim()) &&
  PHRASE.test(text.trim());

/** The dictionary, read as text: we do not execute it to inspect it. */
const dictionary = new Set();
for (const match of stripComments(readFileSync(DICTIONARY, "utf8")).matchAll(
  /"((?:[^"\\]|\\.)*)"\s*:/g,
)) {
  dictionary.add(match[1].replace(/\\"/g, '"'));
}

/** The keys in use, and the places that did not translate. */
const usedKeys = new Set();
const untranslated = [];

/** `t("…")` and `t(`…`)`, with the literal string as first argument. */
const T_CALL = /\bt\(\s*(?:"((?:[^"\\]|\\.)*)"|`((?:[^`\\$]|\\.)*)`)/g;

for (const file of [...files(WEB), ...files(API)]) {
  const relative = path.relative(ROOT, file);
  if (EXCLUDED.some((p) => relative.includes(p))) continue;
  const source = stripComments(readFileSync(file, "utf8"));
  const isApi = relative.startsWith("apps/api/");

  for (const match of source.matchAll(T_CALL)) {
    usedKeys.add((match[1] ?? match[2]).replace(/\\"/g, '"'));
  }

  /**
   * Label tables, translated when read.
   *
   * A table declared at module level is evaluated at import, before the
   * account's language is known: calling `t()` at declaration would freeze the
   * default language for the whole session. So its values go through `t()` at
   * display time. The `_LABELS` suffix is the convention naming them, and the
   * gate treats them as translated strings — they must be.
   */
  for (const table of source.matchAll(
    /\b[A-Z][A-Z0-9_]*_LABELS[^=]*=\s*\{([\s\S]*?)\n\};/g,
  )) {
    /**
     * Every value, not only those that “look like sentences”.
     *
     * A label table only holds displayed labels — “Online”, “Unreachable” are
     * single words the sentence rule would let through. The CSS class names
     * that sit in the same table stand apart: they have no space.
     */
    for (const value of table[1].matchAll(/:\s*"((?:[^"\\]|\\.)+)"/g)) {
      if (isMarkupText(value[1]) && !/^[a-z0-9-]+$/.test(value[1])) {
        usedKeys.add(value[1]);
      }
    }
  }

  /**
   * Server-side, sentences travel as they are to the screen: they are the error
   * messages, and the front looks them up in the dictionary. So they do not go
   * through `t()`, but they must be translated.
   */
  if (isApi) {
    for (const match of source.matchAll(
      /\b(?:invalidInput|conflict|notFound|unauthorized|forbidden)\(\s*"((?:[^"\\]|\\.)*)"/g,
    )) {
      usedKeys.add(match[1]);
    }
    /**
     * `new AppError(code, message)` too.
     *
     * The rate-limiting sentence went through there, and only there: it was
     * never translated, and nobody saw it — it is what the screen shows after
     * three wrong passwords.
     */
    for (const match of source.matchAll(
      /\bnew AppError\(\s*"[a-z_]+"\s*,\s*"((?:[^"\\]|\\.)*)"/g,
    )) {
      usedKeys.add(match[1]);
    }
    continue;
  }

  /**
   * Markup text, swept over **the whole file**.
   *
   * We first delimited the `html\`…\`` templates to look only there. But a
   * template contains others — a list row, a filter chip — and the non-greedy
   * search stopped at the first backtick met. Everything after it in the outer
   * template escaped the check, including a whole paragraph of the filters'
   * help.
   *
   * Looking for `>text<` everywhere is cruder and misses nothing. Outside a
   * template, that pattern does not appear in TypeScript.
   */
  const report = (text, offset) => {
    if (!isMarkupText(text)) return;
    untranslated.push({
      file: relative,
      line: source.slice(0, offset).split("\n").length,
      text: text.trim().replace(/\s+/g, " ").slice(0, 70),
    });
  };

  /**
   * Operators are not tags.
   *
   * `=>`, `>=`, `<=` and `->` produced fake “text nodes” running over whole
   * lines of code. So a lone angle bracket is required on each side.
   */
  for (const node of source.matchAll(/(^|[^=!<>-])>([^<>]*)<(?!=)/gm)) {
    report(node[2].replace(/\$\{[\s\S]*?\}/g, " "), node.index);
  }
  for (const attr of source.matchAll(
    /\b(?:title|aria-label|placeholder|alt)="((?:[^"$]|\$(?!\{))*)"/g,
  )) {
    report(attr[1], attr.index);
  }

  /**
   * Labels declared outside a template.
   *
   * `register("/decks", screen, { nav: { label: "Decks" } })`: the word displays
   * in the navigation bar, but it is written in a route declaration, far from
   * any markup. “Collection” hid the defect for a long time — it is spelled the
   * same in both languages.
   */
  for (const label of source.matchAll(/\blabel:\s*"((?:[^"\\]|\\.)+)"/g)) {
    if (isMarkupText(label[1])) {
      usedKeys.add(label[1]);
    }
  }

  /**
   * Label arrays — `[string, string][]`.
   *
   * A card sheet is a series of “heading, value” pairs declared in an array.
   * The heading displays, but it is neither in a template nor passed to a
   * function: four of them — “Attribute”, “Level”, “Language”, “Copies” — stayed
   * untranslated in an otherwise translated sheet, with nothing reporting it.
   */
  for (const array of source.matchAll(/:\s*\[string,\s*string\]\[\]\s*=([\s\S]*?)\n\s*\];/g)) {
    for (const pair of array[1].matchAll(/\[\s*"((?:[^"\\]|\\.)+)"\s*,/g)) {
      // An identifier value — `monster`, `unresolved` — does not display: it is
      // the pair's key, not its heading. It is written in lowercase.
      if (/^[a-z0-9_-]+$/.test(pair[1])) continue;
      if (isMarkupText(pair[1])) untranslated.push({
        file: relative,
        line: source.slice(0, array.index + pair.index).split("\n").length,
        text: pair[1].slice(0, 70),
      });
    }
  }

  /**
   * Interpolated templates, outside markup.
   *
   * `meta.textContent = \`${n}/${total} printing(s)\`` is a displayed sentence,
   * and nothing told it apart from a path or a query: the check only looked at
   * double-quoted strings. Three leaks hid there, including the collection's
   * summary line — visible on every screen.
   *
   * Inserted values are removed before the examination: what remains is the
   * sentence, and it is what must go through `t()` with `{name}` placeholders.
   */
  for (const template of source.matchAll(/`((?:[^`\\]|\\.)*)`/g)) {
    const phrase = template[1].replace(/\$\{[^}]*\}/g, " ");
    if (!isVisible(phrase)) continue;
    if (phrase.includes("<")) continue;
    untranslated.push({
      file: relative,
      line: source.slice(0, template.index).split("\n").length,
      text: phrase.trim().replace(/\s+/g, " ").slice(0, 70),
    });
  }

  // Strings passed to `el(...)`, `toast(...)`, `throw new Error(...)`.
  for (const match of source.matchAll(/"((?:[^"\\\n]|\\.){4,})"/g)) {
    const text = match[1];
    if (!isVisible(text)) continue;
    if (usedKeys.has(text) || dictionary.has(text)) continue;
    const before = source.slice(Math.max(0, match.index - 40), match.index);
    if (/\bt\(\s*$/.test(before)) continue;
    untranslated.push({
      file: relative,
      line: source.slice(0, match.index).split("\n").length,
      text: text.slice(0, 70),
    });
  }
}

const missingFrench = [...usedKeys].filter((key) => !dictionary.has(key)).sort();
const orphans = [...dictionary].filter((key) => !usedKeys.has(key)).sort();

const listOnly = process.argv.includes("--list");
const total = untranslated.length + missingFrench.length + orphans.length;

if (total === 0) {
  console.log(`✓ ${usedKeys.size} strings, all translated`);
  process.exit(0);
}

const section = (title, entries, render) => {
  if (entries.length === 0) return;
  console.log(`\n${entries.length} ${title}:\n`);
  const shown = listOnly ? entries : entries.slice(0, 8);
  for (const entry of shown) console.log(`    ${render(entry)}`);
  if (!listOnly && entries.length > shown.length) {
    console.log(`    … and ${entries.length - shown.length} more`);
  }
};

section("visible strings outside the dictionary", untranslated, (e) =>
  `${e.file}:${e.line}  “${e.text}”`,
);
section("displayed strings missing from the dictionary", missingFrench, (key) => `“${key}”`);
section("dictionary entries nothing uses any more", orphans, (key) => `“${key}”`);

if (!listOnly) console.log("\n  node scripts/check-translations.mjs --list   to see everything");
process.exit(1);
