/**
 * Scanlistes — inventorier sans verser à la collection.
 *
 * Le besoin : on reçoit un lot de cinquante cartes et on veut savoir ce qu'on
 * en a avant de décider. Les verser à la collection puis exporter et calculer
 * la différence n'est pas tenable — c'est une soustraction là où il suffisait
 * de ne pas mélanger.
 *
 * **Une scanliste ne consulte jamais la collection.** C'est l'inventaire de ce
 * qu'on vient de recevoir, et rien d'autre. Le « −1 » du scanner y décrémente
 * la ligne du lot, jamais la collection : une ligne tombée à zéro reste à zéro,
 * et un « −1 » de plus ne va rien retirer ailleurs. Il n'existe simplement
 * aucun chemin pour ça — le lot en cours ne quitte pas le navigateur.
 *
 * Au versement, les quantités s'ajoutent à celles de la collection. La liste
 * survit, marquée « versée » : on garde la trace de ce qui est entré et quand,
 * et c'est ce qui permet de refuser un second versement. La jeter reste une
 * action distincte — ranger et détruire ne sont pas le même geste.
 */
/**
 * Une ligne de lot.
 *
 * Son identité est le **code d'extension**, pas le passcode : c'est l'exemplaire
 * imprimé qu'on tient, pas la carte en général. Le même Dragon Blanc existe en
 * `LOB-FR001` et en soixante autres impressions.
 */
export type ScanlistLine = {
  setCode: string;
  /**
   * Le nom, quand on l'a.
   *
   * Il arrive **après** la ligne : l'ajout ne l'attend pas. Le navigateur tient
   * le set code au moment où l'on appuie, c'est donc lui qu'on affiche tant que
   * le catalogue n'a pas répondu — et pour toujours, s'il ne répond pas.
   */
  name: string | null;
  passcode: number | null;
  quantity: number;
};

export type ScanlistSummary = {
  id: string;
  name: string;
  createdAt: string;
  /** La date du versement, ou `null` : c'est ce champ qui dit « en attente ». */
  pouredAt: string | null;
  /** Nombre de références distinctes. */
  lineCount: number;
  /** Somme des exemplaires — ce qui entrera en collection au versement. */
  copyCount: number;
};

export type ScanlistDetail = ScanlistSummary & { lines: ScanlistLine[] };

/**
 * Le bilan d'un versement.
 *
 * `poured` compte les exemplaires réellement entrés, `failed` les lignes que le
 * catalogue n'a pas su placer. Les deux sont rendus : une scanliste versée à
 * moitié doit se lire comme telle, pas comme un succès.
 */
export type PourResult = {
  poured: number;
  failed: number;
  pouredAt: string;
  errors: { setCode: string; error: string }[];
};

/** La version du format d'export, écrite dans le fichier et relue à l'import. */
export const SCANLIST_EXPORT_VERSION = 1;

/**
 * Une ligne à zéro n'entre pas dans une liste enregistrée.
 *
 * Elle reste visible pendant qu'on scanne — c'est ce qui permet de voir ce
 * qu'on vient d'annuler, et le plancher est bien zéro, jamais moins. Mais une
 * ligne qui déclare zéro exemplaire ne dit rien qui mérite d'être gardé.
 */
export const keptForSaving = (lines: ScanlistLine[]): ScanlistLine[] =>
  lines.filter((line) => line.quantity > 0);
