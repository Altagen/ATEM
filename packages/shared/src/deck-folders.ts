/**
 * La topologie des dossiers de decks — profondeur, cycles, déplacements.
 *
 * **Une seule implémentation, deux appelants.** Le serveur refuse, l'écran
 * grise : si chacun calculait sa propre réponse, on retomberait sur le travers
 * d'ATEM-old, où `checkDeckAdd` servait à l'affichage pendant que le serveur
 * laissait passer. Ici les deux appellent les mêmes fonctions.
 *
 * Elles ne connaissent que `{ id, parentId }` : ni nom, ni date, ni ligne de
 * base. C'est ce qui les rend éprouvables sans base de données.
 */

/**
 * Jusqu'où les dossiers s'emboîtent.
 *
 * Trois étages, comme dans ATEM-old. Ce n'est pas une limite technique : c'est
 * qu'au-delà on ne retrouve plus rien sans se souvenir de son propre
 * classement, et qu'un fil d'Ariane à quatre niveaux ne tient plus sur un
 * téléphone.
 */
export const DECK_FOLDER_MAX_DEPTH = 3;

export type FolderNode = { id: string; parentId: string | null };

/**
 * Remonte la chaîne des parents, en s'arrêtant net sur un cycle.
 *
 * La garde n'est pas de la superstition : si un cycle entrait en base par un
 * chemin qui ne passe pas par le service, une remontée sans garde tournerait
 * sans fin — côté serveur, la requête ne rendrait jamais la main ; côté écran,
 * l'onglet se figerait.
 */
function* remontee(nodes: FolderNode[], id: string): Generator<FolderNode> {
  const parIdentifiant = new Map(nodes.map((node) => [node.id, node]));
  const vus = new Set<string>();
  let courant = parIdentifiant.get(id);
  while (courant && !vus.has(courant.id)) {
    vus.add(courant.id);
    yield courant;
    courant = courant.parentId ? parIdentifiant.get(courant.parentId) : undefined;
  }
}

/** À quel étage se trouve ce dossier ? 1 à la racine, 0 s'il est inconnu. */
export function folderDepth(nodes: FolderNode[], id: string | null): number {
  if (id === null) return 0;
  let étages = 0;
  for (const _ of remontee(nodes, id)) étages += 1;
  return étages;
}

/** Combien d'étages ce dossier occupe-t-il, lui compris ? 1 s'il est vide. */
export function folderSubtreeHeight(nodes: FolderNode[], id: string): number {
  const enfants = nodes.filter((node) => node.parentId === id);
  if (enfants.length === 0) return 1;
  // La remontée garde contre les cycles ; ici c'est la descente qu'on borne,
  // en ne redescendant jamais dans un dossier déjà traversé.
  const vus = new Set<string>([id]);
  const hauteur = (courant: string): number => {
    const suivants = nodes.filter((node) => node.parentId === courant && !vus.has(node.id));
    if (suivants.length === 0) return 1;
    for (const suivant of suivants) vus.add(suivant.id);
    return 1 + Math.max(...suivants.map((suivant) => hauteur(suivant.id)));
  };
  return hauteur(id);
}

/** `id` est-il dans la branche de `ancetre` — ou cet ancêtre lui-même ? */
export function folderIsInside(nodes: FolderNode[], id: string, ancetre: string): boolean {
  for (const node of remontee(nodes, id)) {
    if (node.id === ancetre) return true;
  }
  return false;
}

/**
 * Ce dossier peut-il être déposé là ?
 *
 * Trois refus : dans lui-même, dans l'un des siens — la branche disparaîtrait
 * de l'arbre sans que rien ne l'efface — et au-delà du dernier étage, en
 * comptant **ce qu'il emporte** et non lui seul.
 *
 * La racine (`null`) accepte toujours : un sous-arbre y tient forcément,
 * puisqu'il tenait déjà quelque part.
 */
export function folderCanHost(
  nodes: FolderNode[],
  movingId: string,
  targetId: string | null,
): boolean {
  if (targetId === null) return true;
  if (targetId === movingId) return false;
  if (folderIsInside(nodes, targetId, movingId)) return false;
  return folderDepth(nodes, targetId) + folderSubtreeHeight(nodes, movingId) <= DECK_FOLDER_MAX_DEPTH;
}
