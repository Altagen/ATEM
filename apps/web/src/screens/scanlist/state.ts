/**
 * L'état des scanlistes.
 *
 * **Le lot en cours ne quitte jamais le navigateur, et ne lui survit pas.**
 * Rien n'est écrit dans `localStorage` : ce qui n'a pas été explicitement
 * enregistré meurt avec l'onglet, et il faudra rescanner. C'est une décision,
 * pas un oubli — un demi-état persisté qu'on retrouve trois jours plus tard
 * sans savoir ce qu'il contient vaut moins que rien.
 *
 * Il vit ici, au niveau du module : il traverse donc une navigation interne —
 * aller voir sa collection et revenir ne perd pas la pile en cours — et
 * disparaît à la fermeture.
 */
import type { ScanlistDetail, ScanlistLine, ScanlistSummary } from "@atem/shared";

export type Draft = {
  name: string;
  lines: ScanlistLine[];
};

export type ScanlistState = {
  loading: boolean;
  items: ScanlistSummary[];
  /**
   * Les lignes que le dernier versement n'a pas su placer.
   *
   * Le serveur les nomme depuis le début ; l'écran n'en montrait que le
   * nombre. « 3 lignes en échec » sans dire lesquelles ne laisse rien faire —
   * ni corriger un code, ni comprendre pourquoi.
   */
  pourErrors: { setCode: string; error: string }[];
  /** Le lot ouvert en consultation, quand l'URL en désigne un. */
  opened: ScanlistDetail | null;
  /** Le lot en cours de constitution, ou `null` si l'on n'en a pas commencé. */
  draft: Draft | null;
  error: string;
};

/**
 * Un seul objet, muté sur place — **jamais remplacé**.
 *
 * `resetView` le réaffectait, et l'écran en gardait une référence prise juste
 * avant : ses mutations partaient alors dans un objet orphelin pendant que les
 * fonctions de ce module écrivaient dans le nouveau. L'écran s'affichait, et
 * plus aucun bouton ne faisait quoi que ce soit.
 *
 * L'identité de cet objet fait partie du contrat : tout le reste du module
 * suppose que `scanlistState()` rend toujours le même.
 */
const state: ScanlistState = {
  loading: true,
  items: [],
  pourErrors: [],
  opened: null,
  draft: null,
  error: "",
};

export const scanlistState = (): ScanlistState => state;

/**
 * Remet la vue à zéro, sans toucher au lot en cours.
 *
 * Le brouillon traverse volontairement les changements d'écran : aller
 * vérifier une carte dans sa collection ne perd pas la pile qu'on inventorie.
 */
export function resetView(): void {
  state.loading = true;
  state.items = [];
  state.opened = null;
  state.error = "";
  // Les échecs appartiennent au versement qu'on vient de voir, pas au suivant.
  state.pourErrors = [];
}

export function startDraft(): void {
  state.draft = { name: "", lines: [] };
}

export function discardDraft(): void {
  state.draft = null;
}

/**
 * Ajoute ou retire un exemplaire dans le lot — **et rien d'autre**.
 *
 * C'est la différence qui définit cet écran. Un « −1 » décrémente la ligne du
 * lot ; arrivée à zéro, elle y reste, visible, et les « −1 » suivants ne font
 * rien. Ils ne vont surtout pas retirer un exemplaire de la collection : le lot
 * n'a aucun lien avec elle tant qu'on ne l'a pas versé.
 *
 * La ligne à zéro reste affichée exprès : c'est ce qui permet de voir ce qu'on
 * vient d'annuler. Elle sera écartée à l'enregistrement.
 */
export function applyToDraft(setCode: string, delta: number): ScanlistLine {
  const draft = state.draft ?? { name: "", lines: [] };
  state.draft = draft;

  const existing = draft.lines.find((line) => line.setCode === setCode);
  if (existing) {
    existing.quantity = Math.max(0, existing.quantity + delta);
    return existing;
  }

  const line: ScanlistLine = {
    setCode,
    name: null,
    passcode: null,
    quantity: Math.max(0, delta),
  };
  // Le dernier scanné en tête : c'est celui qu'on vérifie du regard.
  draft.lines.unshift(line);
  return line;
}

/** Le nom arrivé après coup se pose sur la ligne, si elle est encore là. */
export function nameDraftLine(setCode: string, name: string, passcode: number | null): boolean {
  const line = state.draft?.lines.find((l) => l.setCode === setCode);
  if (!line || line.name) return false;
  line.name = name;
  line.passcode = passcode;
  return true;
}

export const draftCopies = (draft: Draft): number =>
  draft.lines.reduce((sum, line) => sum + line.quantity, 0);
