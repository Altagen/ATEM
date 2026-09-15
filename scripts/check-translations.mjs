/**
 * Rien de visible ne doit échapper au dictionnaire.
 *
 * Trois défauts, trois refus :
 *
 * — **Une chaîne affichée hors de `t()`.** Elle restera en anglais pour un
 *   compte français, sans que rien ne le signale. C'est le défaut qui ne se voit
 *   qu'en basculant la langue, donc jamais.
 *
 * — **Une chaîne traduite qui n'a pas d'anglais.** `t()` rend alors le français
 *   par repli : l'écran est à moitié traduit, ce qui est pire qu'un écran qui
 *   ne l'est pas.
 *
 * — **Une entrée du dictionnaire que plus rien n'emploie.** C'est l'objection
 *   classique au « français en clé » : changer la phrase orphelinerait sa
 *   traduction en silence. Ici elle fait échouer la construction, et l'ancienne
 *   entrée se voit — on sait quoi reprendre.
 *
 * Usage :
 *   node scripts/check-translations.mjs           # barrière
 *   node scripts/check-translations.mjs --list    # le détail, pour travailler
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const WEB = path.join(ROOT, "apps/web/src");
const API = path.join(ROOT, "apps/api/src");
const DICO = path.join(WEB, "platform/i18n/fr.ts");

/**
 * Ce que le contrôle ne regarde pas.
 *
 * Le moteur OCR est repris tel quel d'ATEM-old, commentaires anglais compris,
 * et n'affiche rien : ses chaînes sont des étiquettes de journal. Les
 * dictionnaires, eux, sont l'endroit où le français a le droit d'être une
 * donnée.
 */
const HORS_CONTROLE = [
  "screens/collection/ocr/",
  "platform/i18n/",
  "platform/ygo-labels.ts",
];

const IGNORED_DIRS = new Set(["node_modules", "dist", "staged"]);

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
 * Retire les commentaires **sans déplacer les lignes**.
 *
 * Les remplacer par une espace collapsait les retours à la ligne, et chaque
 * numéro rapporté ensuite était faux d'autant — d'autant plus faux que le
 * fichier était commenté, c'est-à-dire partout ici. On rend donc autant de
 * retours à la ligne que le commentaire en contenait.
 */
const blanchir = (bloc) => bloc.replace(/[^\n]/g, " ");

const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, blanchir)
    .replace(/^\s*\/\/.*$/gm, "")
    // `<!-- … -->` explique le balisage à qui le lit, pas à qui l'affiche.
    .replace(/<!--[\s\S]*?-->/g, blanchir);

/**
 * Ce qui est visible, et ce qui ne l'est pas.
 *
 * Deux règles, pas une heuristique unique :
 *
 * — **Le texte du balisage et les attributs qui s'affichent** — `title`,
 *   `aria-label`, `placeholder`, `alt` — sont visibles **par nature**. On exige
 *   la traduction dès qu'ils portent une lettre, sans se demander s'ils ont
 *   l'air français. La première version cherchait des accents ou deux mots
 *   français courants, et laissait passer « Scanner », « Compact »,
 *   « Croissant », « Ajouter au lot » : quatre libellés bien visibles, trop
 *   courts ou trop peu accentués pour être reconnus.
 *
 * — **Les chaînes ordinaires du code** — arguments de `toast`, de `el`, d'une
 *   `Error` — sont majoritairement techniques. Là, l'heuristique reste : un
 *   accent, ou deux mots français courants.
 */
const LETTRE = /\p{L}{2}/u;
/**
 * Une phrase affichée commence par une majuscule et contient une espace.
 *
 * La règle précédente cherchait des accents ou des mots-outils français — elle
 * n'a plus d'objet depuis que la source est anglaise (2026-09-14). Celle-ci ne
 * dépend d'aucune langue : « Deck not found. » est une phrase, `text/plain`,
 * `POST` et `deck-tile` n'en sont pas.
 */
const PHRASE = /^\p{Lu}[^]*\s/u;
/**
 * Ce qui ressemble à du code n'est pas une phrase.
 *
 * Le balayage `>texte<` court sur tout le fichier : entre le chevron d'une
 * balise et celui d'une autre, il ramasse parfois des lignes de TypeScript
 * entières — un point-virgule, un accent grave ou un guillemet suffisent à les
 * reconnaître, et aucun n'apparaît dans le texte qu'on affiche. Un `${` qui
 * survit au nettoyage dit la même chose : on a mal découpé, ce n'est pas du
 * texte.
 */
const CODE = /[;`"=]|\$\{/;

/**
 * Un tracé SVG n'est pas une phrase.
 *
 * `M12 2l4 8 8 1-6 5 2 8-8-4-8 4 2-8-6-5 8-1z` commence par une majuscule et
 * contient des espaces : la règle « majuscule puis espace » le prenait pour du
 * texte. Un tracé n'a que des commandes et des nombres.
 */
const TRACE_SVG = /^[MmLlHhVvCcSsQqTtAaZz][\d\s.,-]*[MmLlHhVvCcSsQqTtAaZz\d\s.,-]*$/;

/**
 * Le balisage : toute suite de lettres compte.
 *
 * Sauf une annotation de type — `Record<string, string>(tag: K, attrs: Record<`
 * fabrique un faux nœud entre deux chevrons de générique. Deux mots séparés par
 * un deux-points n'apparaissent pas dans du texte affiché.
 */
const ANNOTATION = /[\w)\]]\s*:\s*\w/;

/**
 * Une liste de classes n'est pas une phrase.
 *
 * `"deck-stepper item-actions"` choisi par un ternaire à l'intérieur d'un
 * attribut `class` : que des minuscules et des tirets, jamais de majuscule ni
 * de ponctuation. Aucun texte affiché ne ressemble à ça.
 */
const CLASSES = /^[a-z0-9 -]+$/;

/**
 * Un glyphe décoratif non latin n'est pas à traduire.
 *
 * La vignette par défaut d'un deck porte « 遊戯王 » — le nom du jeu en japonais,
 * qui reste le même dans toutes les langues. Réclamer sa traduction serait
 * demander de traduire un logo.
 */
const LATIN = /\p{Script=Latin}/u;

const estBalisage = (texte) =>
  !CODE.test(texte) &&
  !ANNOTATION.test(texte) &&
  !(CLASSES.test(texte.trim()) && texte.includes("-")) &&
  LATIN.test(texte) &&
  LETTRE.test(texte.trim());

/** Le code ordinaire : on ne réclame que ce qui ressemble à une phrase. */
const estVisible = (texte) =>
  texte.trim().length >= 4 &&
  !CODE.test(texte) &&
  !TRACE_SVG.test(texte.trim()) &&
  PHRASE.test(texte.trim());

/** Le dictionnaire, lu comme un texte : on ne l'exécute pas pour l'inspecter. */
const dico = new Set();
for (const match of stripComments(readFileSync(DICO, "utf8")).matchAll(
  /"((?:[^"\\]|\\.)*)"\s*:/g,
)) {
  dico.add(match[1].replace(/\\"/g, '"'));
}

/** Les clés employées, et les endroits qui n'ont pas traduit. */
const employees = new Set();
const nonTraduites = [];

/** `t("…")` et `t(`…`)`, avec la chaîne littérale en premier argument. */
const APPEL_T = /\bt\(\s*(?:"((?:[^"\\]|\\.)*)"|`((?:[^`\\$]|\\.)*)`)/g;

for (const file of [...files(WEB), ...files(API)]) {
  const relative = path.relative(ROOT, file);
  if (HORS_CONTROLE.some((p) => relative.includes(p))) continue;
  const source = stripComments(readFileSync(file, "utf8"));
  const estApi = relative.startsWith("apps/api/");

  for (const match of source.matchAll(APPEL_T)) {
    employees.add((match[1] ?? match[2]).replace(/\\"/g, '"'));
  }

  /**
   * Les tables d'étiquettes, traduites à la lecture.
   *
   * Une table déclarée au niveau du module est évaluée à l'import, avant que la
   * langue du compte soit connue : y appeler `t()` à la déclaration figerait le
   * français pour toute la session. Ses valeurs passent donc par `t()` au moment
   * de l'affichage. Le suffixe `_LABELS` est la convention qui les désigne, et
   * la barrière les traite comme des chaînes traduites — elles doivent l'être.
   */
  for (const table of source.matchAll(
    /\b[A-Z][A-Z0-9_]*_LABELS[^=]*=\s*\{([\s\S]*?)\n\};/g,
  )) {
    /**
     * Toutes les valeurs, pas seulement celles qui « ont l'air françaises ».
     *
     * Une table d'étiquettes ne contient que des libellés affichés — « En
     * ligne », « Injoignable » n'ont ni accent ni mot outil, et l'heuristique
     * les laissait passer. Les noms de classes CSS qui voisinent dans la même
     * table s'en distinguent : ils n'ont pas d'espace.
     */
    for (const valeur of table[1].matchAll(/:\s*"((?:[^"\\]|\\.)+)"/g)) {
      if (estBalisage(valeur[1]) && !/^[a-z0-9-]+$/.test(valeur[1])) {
        employees.add(valeur[1]);
      }
    }
  }

  /**
   * Côté serveur, les phrases voyagent telles quelles jusqu'à l'écran : ce sont
   * les messages d'erreur, et le front les cherche au dictionnaire. Elles n'ont
   * donc pas à passer par `t()`, mais elles doivent être traduites.
   */
  if (estApi) {
    for (const match of source.matchAll(
      /\b(?:invalidInput|conflict|notFound|unauthorized|forbidden)\(\s*"((?:[^"\\]|\\.)*)"/g,
    )) {
      employees.add(match[1]);
    }
    /**
     * `new AppError(code, message)` aussi.
     *
     * La phrase de la limitation de débit passait par là, et par là seulement :
     * elle n'a jamais été traduite, et personne ne l'a vu — c'est l'écran qui
     * l'affiche quand on se trompe trois fois de mot de passe.
     */
    for (const match of source.matchAll(
      /\bnew AppError\(\s*"[a-z_]+"\s*,\s*"((?:[^"\\]|\\.)*)"/g,
    )) {
      employees.add(match[1]);
    }
    continue;
  }

  /**
   * Le texte du balisage, balayé sur **tout le fichier**.
   *
   * On délimitait d'abord les gabarits `html\`…\`` pour n'y chercher que là.
   * Mais un gabarit en contient d'autres — une ligne de liste, une puce de
   * filtre — et la recherche non gourmande s'arrêtait au premier accent grave
   * rencontré. Tout ce qui suivait dans le gabarit extérieur échappait au
   * contrôle, dont un paragraphe entier de l'aide des filtres.
   *
   * Chercher `>texte<` partout est plus grossier et ne rate rien. Hors d'un
   * gabarit, ce motif n'apparaît pas dans du TypeScript.
   */
  const signaler = (texte, décalage) => {
    if (!estBalisage(texte)) return;
    nonTraduites.push({
      file: relative,
      line: source.slice(0, décalage).split("\n").length,
      texte: texte.trim().replace(/\s+/g, " ").slice(0, 70),
    });
  };

  /**
   * Les opérateurs ne sont pas des balises.
   *
   * `=>`, `>=`, `<=` et `->` fabriquaient des faux « nœuds de texte » qui
   * couraient sur des lignes de code entières. On exige donc un chevron seul de
   * chaque côté.
   */
  for (const noeud of source.matchAll(/(^|[^=!<>-])>([^<>]*)<(?!=)/gm)) {
    signaler(noeud[2].replace(/\$\{[\s\S]*?\}/g, " "), noeud.index);
  }
  for (const attr of source.matchAll(
    /\b(?:title|aria-label|placeholder|alt)="((?:[^"$]|\$(?!\{))*)"/g,
  )) {
    signaler(attr[1], attr.index);
  }

  /**
   * Les libellés déclarés ailleurs que dans un gabarit.
   *
   * `register("/decks", écran, { nav: { label: "Decks" } })` : le mot s'affiche
   * dans la barre de navigation, mais il est écrit dans une déclaration de
   * route, loin de tout balisage. « Collection » a masqué le défaut longtemps —
   * il s'écrit pareil dans les deux langues.
   */
  for (const étiquette of source.matchAll(/\blabel:\s*"((?:[^"\\]|\\.)+)"/g)) {
    if (estBalisage(étiquette[1])) {
      employees.add(étiquette[1]);
    }
  }

  /**
   * Les tableaux d'étiquettes — `[string, string][]`.
   *
   * Une fiche de carte est une suite de couples « intitulé, valeur » déclarés
   * dans un tableau. L'intitulé s'affiche, mais il n'est ni dans un gabarit ni
   * passé à une fonction : quatre d'entre eux — « Attribut », « Niveau »,
   * « Langue », « Exemplaires » — sont restés en français dans une fiche
   * entièrement anglaise, sans que rien ne le signale.
   */
  for (const tableau of source.matchAll(/:\s*\[string,\s*string\]\[\]\s*=([\s\S]*?)\n\s*\];/g)) {
    for (const couple of tableau[1].matchAll(/\[\s*"((?:[^"\\]|\\.)+)"\s*,/g)) {
      // Une valeur d'identifiant — `monster`, `unresolved` — ne s'affiche pas :
      // c'est la clé du couple, pas son intitulé. Elle s'écrit en minuscules.
      if (/^[a-z0-9_-]+$/.test(couple[1])) continue;
      if (estBalisage(couple[1])) nonTraduites.push({
        file: relative,
        line: source.slice(0, tableau.index + couple.index).split("\n").length,
        texte: couple[1].slice(0, 70),
      });
    }
  }

  /**
   * Les gabarits à interpolation, hors balisage.
   *
   * `meta.textContent = \`${n}/${total} édition(s)\`` est une phrase affichée,
   * et rien ne la distinguait d'un chemin ou d'une requête : le contrôle ne
   * regardait que les chaînes entre guillemets. Trois fuites s'y cachaient,
   * dont la ligne de bilan de la collection — visible sur chaque écran.
   *
   * Les valeurs insérées sont retirées avant l'examen : ce qui reste est la
   * phrase, et c'est elle qui doit passer par `t()` avec des `{nom}`.
   */
  for (const gabarit of source.matchAll(/`((?:[^`\\]|\\.)*)`/g)) {
    const phrase = gabarit[1].replace(/\$\{[^}]*\}/g, " ");
    if (!estVisible(phrase)) continue;
    if (phrase.includes("<")) continue;
    nonTraduites.push({
      file: relative,
      line: source.slice(0, gabarit.index).split("\n").length,
      texte: phrase.trim().replace(/\s+/g, " ").slice(0, 70),
    });
  }

  // Les chaînes passées à `el(...)`, `toast(...)`, `throw new Error(...)`.
  for (const match of source.matchAll(/"((?:[^"\\\n]|\\.){4,})"/g)) {
    const texte = match[1];
    if (!estVisible(texte)) continue;
    if (employees.has(texte) || dico.has(texte)) continue;
    const avant = source.slice(Math.max(0, match.index - 40), match.index);
    if (/\bt\(\s*$/.test(avant)) continue;
    nonTraduites.push({
      file: relative,
      line: source.slice(0, match.index).split("\n").length,
      texte: texte.slice(0, 70),
    });
  }
}

const sansAnglais = [...employees].filter((clé) => !dico.has(clé)).sort();
const orphelines = [...dico].filter((clé) => !employees.has(clé)).sort();

const listOnly = process.argv.includes("--list");
const total = nonTraduites.length + sansAnglais.length + orphelines.length;

if (total === 0) {
  console.log(`✓ ${employees.size} chaînes, toutes traduites`);
  process.exit(0);
}

const bloc = (titre, entrées, rendre) => {
  if (entrées.length === 0) return;
  console.log(`\n${entrées.length} ${titre} :\n`);
  const montrées = listOnly ? entrées : entrées.slice(0, 8);
  for (const e of montrées) console.log(`    ${rendre(e)}`);
  if (!listOnly && entrées.length > montrées.length) {
    console.log(`    … et ${entrées.length - montrées.length} autres`);
  }
};

bloc("chaînes visibles hors du dictionnaire", nonTraduites, (e) =>
  `${e.file}:${e.line}  « ${e.texte} »`,
);
bloc("chaînes affichées absentes du dictionnaire", sansAnglais, (c) => `« ${c} »`);
bloc("entrées du dictionnaire que plus rien n'emploie", orphelines, (c) => `« ${c} »`);

if (!listOnly) console.log("\n  node scripts/check-translations.mjs --list   pour tout voir");
process.exit(1);
