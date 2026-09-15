/**
 * Ce qui décide qu'une règle CSS est morte — **en un seul endroit**.
 *
 * `check-dead-css.mjs` et `prune-dead-css.mjs` portaient chacun leur copie de
 * ce raisonnement. Ils ne pouvaient donc pas diverger sans qu'on s'en aperçoive
 * — ils ont fait pire : ils ont porté le même défaut, et le contrôle a déclaré
 * la feuille propre pendant que 58 règles y dormaient. Une logique dupliquée ne
 * se contredit pas, elle se trompe deux fois.
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
 * Relève ce que le balisage pose, et ce qu'il assemble à l'exécution.
 *
 * Les classes construites — `star-badge-${kind}`, `"toast-" + tone` —
 * n'apparaissent nulle part en entier. On garde les fragments littéraux qui
 * précèdent une interpolation, et l'on tient pour vivante toute classe qui
 * commence par l'un d'eux et dont le reste est un jeton du code.
 */
export function readMarkup(sourceRoot, horsBalisage = new Set()) {
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
    if (tokens.has(cls) || horsBalisage.has(cls)) return true;
    for (const prefix of prefixes) {
      if (!cls.startsWith(prefix)) continue;
      const rest = cls.slice(prefix.length);
      if (!rest || tokens.has(rest)) return true;
    }
    return false;
  }

  /**
   * Un sélecteur est vivant si **toutes** ses classes le sont : `.chip.chip-level`
   * ne s'applique jamais si `chip-level` n'est posée nulle part, même si `.chip`
   * l'est. Un sélecteur sans classe — `body`, `:root`, `a:hover` — est vivant.
   */
  const selectorAlive = (selector) => {
    const classes = selector.match(/\.(-?[a-zA-Z][\w-]*)/g) ?? [];
    return classes.length === 0 || classes.every((c) => alive(c.slice(1)));
  };

  /**
   * Le commentaire qui précède une règle n'en fait pas partie.
   *
   * `rules()` fait courir le « sélecteur » depuis la fin de la règle
   * précédente, commentaires compris — c'est ce qui permet à la purge de les
   * emporter avec la règle qu'ils expliquent. Mais le test découpe sur les
   * virgules : la moindre virgule dans un commentaire fabriquait un fragment
   * **sans aucune classe**, tenu pour un sélecteur vivant, et `some` déclarait
   * la règle vivante.
   *
   * Autrement dit : toute règle précédée d'un commentaire contenant une virgule
   * était intouchable. Dans une base commentée comme celle-ci, c'était
   * l'écrasante majorité — 58 règles, ~679 lignes. Découvert parce qu'un toast
   * s'affichait transparent : `.toast-ok` n'était posée par aucun balisage et
   * dormait là depuis le début.
   */
  const ruleAlive = (selectors) => {
    const parts = selectors
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .split(",")
      .filter((part) => part.trim());
    // Plus rien à juger une fois les commentaires retirés : on ne condamne pas
    // ce qu'on n'a pas su lire.
    if (parts.length === 0) return true;
    return parts.some(selectorAlive);
  };

  return { alive, selectorAlive, ruleAlive };
}

/**
 * Découpe une feuille en règles, **sélecteur compris**.
 *
 * `from` pointe le début du sélecteur, pas l'accolade ouvrante. La distinction
 * n'est pas cosmétique : découper sur l'accolade laissait le sélecteur derrière
 * lui à chaque suppression, et produisait des feuilles que PostCSS refusait de
 * lire — `@media (max-width: 900px)` sans corps, `.edition-set,` sans règle.
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
