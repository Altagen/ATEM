/**
 * What decides that a CSS rule is dead — **in one place only**.
 *
 * `check-dead-css.mjs` and `prune-dead-css.mjs` each carried their own copy of
 * this reasoning. So they could not diverge without it being noticed — they did
 * worse: they carried the same defect, and the check declared the sheet clean
 * while 58 rules slept in it. Duplicated logic does not contradict itself, it is
 * wrong twice.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

export function files(dir, ext, acc = [], ignored = new Set(["staged"])) {
  for (const name of readdirSync(dir)) {
    if (ignored.has(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) files(full, ext, acc, ignored);
    else if (full.endsWith(ext)) acc.push(full);
  }
  return acc;
}

/**
 * Collects what the markup sets, and what it assembles at runtime.
 *
 * Built classes — `star-badge-${kind}`, `"toast-" + tone` — appear nowhere in
 * full. We keep the literal fragments preceding an interpolation, and count as
 * alive any class starting with one of them whose remainder is a token of the
 * code.
 */
export function readMarkup(sourceRoot) {
  const sources = files(sourceRoot, ".ts").filter((f) => !f.endsWith(".test.ts"));
  const markup = sources.map((f) => stripComments(readFileSync(f, "utf8"))).join("\n");
  const tokens = new Set(markup.match(/[A-Za-z][\w-]*/g) ?? []);

  const prefixes = new Set();
  for (const match of markup.matchAll(/class="([^"]*?)\$\{/g)) {
    const last = match[1].trim().split(/\s+/).at(-1);
    if (last?.endsWith("-")) prefixes.add(last);
  }
  for (const match of markup.matchAll(/["']([^"'\n]*?[a-z][\w-]*-)["']\s*[+,]/g)) {
    const last = match[1].trim().split(/\s+/).at(-1);
    if (last && /^[a-z][\w-]*-$/.test(last)) prefixes.add(last);
  }

  function alive(cls) {
    if (tokens.has(cls)) return true;
    for (const prefix of prefixes) {
      if (!cls.startsWith(prefix)) continue;
      const rest = cls.slice(prefix.length);
      if (!rest || tokens.has(rest)) return true;
    }
    return false;
  }

  /**
   * A selector is alive if **all** its classes are: `.chip.chip-level` never
   * applies if `chip-level` is set nowhere, even if `.chip` is. A selector with
   * no class — `body`, `:root`, `a:hover` — is alive.
   */
  const selectorAlive = (selector) => {
    const classes = selector.match(/\.(-?[a-zA-Z][\w-]*)/g) ?? [];
    return classes.length === 0 || classes.every((c) => alive(c.slice(1)));
  };

  /**
   * The comment preceding a rule is not part of it.
   *
   * `rules()` runs the “selector” from the end of the previous rule, comments
   * included — that is what lets the purge take them along with the rule they
   * explain. But the test splits on commas: the slightest comma in a comment
   * produced a fragment **with no class at all**, counted as a live selector,
   * and `some` declared the rule alive.
   *
   * In other words: any rule preceded by a comment containing a comma was
   * untouchable. In a codebase commented like this one, that was the vast
   * majority — 58 rules, ~679 lines. Found because a toast displayed
   * transparent: `.toast-ok` was set by no markup and had slept there from the
   * start.
   */
  const ruleAlive = (selectors) => {
    const parts = selectors
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .split(",")
      .filter((part) => part.trim());
    // Nothing left to judge once comments are removed: we do not condemn what
    // we could not read.
    if (parts.length === 0) return true;
    return parts.some(selectorAlive);
  };

  return { ruleAlive };
}

/**
 * Cuts a sheet into rules, **selector included**.
 *
 * `from` points at the start of the selector, not the opening brace. The
 * distinction is not cosmetic: cutting at the brace left the selector behind at
 * every removal, and produced sheets PostCSS refused to read —
 * `@media (max-width: 900px)` with no body, `.edition-set,` with no rule.
 */
export function rules(css) {
  const out = [];
  let depth = 0;
  let selectorStart = 0;
  let selector = "";

  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i];
    if (ch === "{") {
      if (depth === 0) selector = css.slice(selectorStart, i);
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        out.push({ selector: selector.trim(), from: selectorStart, to: i + 1 });
        selectorStart = i + 1;
      }
    }
  }
  return out;
}

export const lineOf = (css, index) => css.slice(0, index).split("\n").length;

/**
 * The body of a conditional group rule — `@media`, `@supports`, `@container` —
 * or `null` for any other rule.
 *
 * A rule's `selector` runs from the end of the previous rule, so it carries the
 * comment written above it. Testing `selector.startsWith("@")` therefore missed
 * every block preceded by a comment, and slicing from `from` instead of the
 * opening brace handed back a body that started inside the header: in both
 * cases the nested rules were never judged. Nothing inside a `@media` block had
 * been checked — nine dead rules and three empty blocks slept there.
 */
export function groupBody(css, rule) {
  const header = rule.selector.replace(/\/\*[\s\S]*?\*\//g, " ").trim();
  if (!/^@(media|supports|container)\b/.test(header)) return null;
  const open = css.indexOf("{", rule.from + rule.selector.length);
  return { body: css.slice(open + 1, rule.to - 1), offset: open + 1, header };
}
