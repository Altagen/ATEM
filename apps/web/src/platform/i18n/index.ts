/**
 * Les traductions — **le français est la clé**.
 *
 * `t("Ma collection")` rend « Ma collection » en français et « My collection »
 * en anglais. Les gabarits restent donc lisibles : on lit la phrase, pas un
 * identifiant comme `collection.title` qu'il faut aller résoudre ailleurs.
 *
 * L'objection habituelle à ce choix — changer le français orpheline
 * silencieusement l'anglais — ne tient pas ici : `scripts/check-translations.mjs`
 * refuse toute chaîne sans traduction **et** toute traduction que plus rien
 * n'emploie. Le défaut n'est pas silencieux, il fait échouer la construction.
 *
 * Le dictionnaire couvre aussi les messages du serveur. L'API répond en
 * français ; le front cherche ce message dans le dictionnaire avant de
 * l'afficher. C'est ce qui évite d'avoir à inventer un code d'erreur distinct
 * pour chacune des trente phrases qu'elle peut renvoyer.
 */
import { EN } from "./en.js";

export type Locale = "fr" | "en";

let current: Locale = "fr";

export const locale = (): Locale => current;

/**
 * Fixe la langue de l'interface.
 *
 * Elle vient du compte, pas du navigateur : c'est un réglage qu'on choisit une
 * fois et qu'on retrouve sur son téléphone comme sur son ordinateur.
 */
export function setLocale(next: Locale): void {
  current = next;
  document.documentElement.lang = next;
}

/**
 * Traduit, et remplace les valeurs nommées.
 *
 * Les valeurs sont écrites `{nom}` plutôt qu'insérées par interpolation : une
 * phrase coupée en trois morceaux autour d'un `${}` ne se traduit pas — l'ordre
 * des mots change d'une langue à l'autre, et c'est précisément ce qu'on veut
 * pouvoir déplacer.
 */
export function t(fr: string, vars?: Record<string, string | number>): string {
  const base = current === "fr" ? fr : (EN[fr] ?? fr);
  if (!vars) return base;
  /**
   * Le motif est **unicode**, et ce n'est pas un détail.
   *
   * `\w` ne couvre pas les lettres accentuées : `{montrées}`, `{réf}`,
   * `{étape}` et `{où}` ne trouvaient pas leur valeur et s'affichaient tels
   * quels, accolades comprises, sur la ligne de bilan de la collection. Le
   * typage n'y voyait rien — les clés existaient bel et bien dans l'objet.
   * Trouvé par l'épreuve de bout en bout, pas par la relecture.
   */
  return base.replace(/\{([\p{L}\p{N}_]+)\}/gu, (entier, nom: string) =>
    nom in vars ? String(vars[nom]) : entier,
  );
}

/**
 * Traduit un message venu du serveur.
 *
 * Il arrive en français ; s'il figure au dictionnaire, on rend sa version dans
 * la langue courante. Sinon on le rend tel quel — un message qu'on n'a pas su
 * traduire vaut mieux qu'un message générique qui n'apprend rien.
 */
export const tServer = (message: string): string => t(message);
