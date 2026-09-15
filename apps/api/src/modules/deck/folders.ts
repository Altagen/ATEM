/**
 * Les dossiers de decks — le rangement, et rien d'autre.
 *
 * Rien ici ne connaît une carte : un dossier porte des decks et d'autres
 * dossiers, c'est tout. La séparation vient d'ATEM-old, où elle tenait déjà.
 *
 * **Trois règles font tout le sujet** : la profondeur maximale, l'absence de
 * cycle, et ce qui arrive au contenu d'un dossier qu'on efface. Aucune des
 * trois ne s'exprime dans une contrainte de colonne — elles parlent du chemin
 * complet d'une ligne — donc elles vivent ici, avec leurs épreuves.
 *
 * **Les lectures prennent un propriétaire, les écritures un viewer** (ADR-009).
 */
import { and, eq } from "drizzle-orm";
import {
  DECK_FOLDER_MAX_DEPTH, folderDepth, folderIsInside, folderSubtreeHeight,
  type FolderNode,
} from "@atem/shared";
import type { Database } from "../../db/client.js";
import { conflict, invalidInput, notFound } from "../../platform/errors.js";
import { requireUuid } from "../../platform/identifiers.js";
import { deckFolders, decks, type DeckFolderRow } from "./schema.js";

export type DeckFolder = {
  id: string;
  parentId: string | null;
  name: string;
  /** Le chemin depuis la racine, le sien compris — « Meta », « Tier 1 ». */
  path: string[];
  /** 1 à la racine. Ce que la limite compte. */
  depth: number;
  createdAt: string;
  updatedAt: string;
};

/**
 * Tous les dossiers d'une personne, d'un coup.
 *
 * ATEM-old relisait la table entière à chaque contrôle — trois fois de suite
 * pour une seule création. Comme on en a besoin en entier pour calculer un
 * chemin ou une profondeur, on la lit **une fois** et tout le reste travaille
 * en mémoire. Un joueur en a quelques dizaines au plus.
 */
async function charger(db: Database, userId: string): Promise<Map<string, DeckFolderRow>> {
  const rows = await db.select().from(deckFolders).where(eq(deckFolders.userId, userId));
  return new Map(rows.map((row) => [row.id, row]));
}

/**
 * Le chemin d'un dossier, racine d'abord.
 *
 * La garde `vus` n'est pas de la superstition : si un cycle entrait en base par
 * un autre chemin que ce service, la remontée tournerait sans fin et la requête
 * ne rendrait jamais la main. On préfère un chemin tronqué à un serveur qui se
 * bloque.
 */
function cheminDe(row: DeckFolderRow, byId: Map<string, DeckFolderRow>): string[] {
  const chemin: string[] = [];
  const vus = new Set<string>();
  let courant: DeckFolderRow | undefined = row;
  while (courant && !vus.has(courant.id)) {
    vus.add(courant.id);
    chemin.unshift(courant.name);
    courant = courant.parentId ? byId.get(courant.parentId) : undefined;
  }
  return chemin;
}

const toFolder = (row: DeckFolderRow, byId: Map<string, DeckFolderRow>): DeckFolder => {
  const path = cheminDe(row, byId);
  return {
    id: row.id,
    parentId: row.parentId,
    name: row.name,
    path,
    depth: path.length,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
};

/**
 * L'arbre réduit à sa topologie, pour les fonctions partagées.
 *
 * Elles servent aussi à l'écran, qui grise ce que le serveur refuserait : une
 * seule implémentation, deux appelants. C'est la leçon de `checkDeckAdd`, qui
 * dans ATEM-old grisait un bouton pendant que le serveur laissait passer.
 */
const topologie = (byId: Map<string, DeckFolderRow>): FolderNode[] =>
  [...byId.values()].map((row) => ({ id: row.id, parentId: row.parentId }));

const nomPropre = (brut: string): string => {
  const propre = brut.trim();
  if (!propre) throw invalidInput("Give the folder a name.");
  return propre;
};

/**
 * Le conflit de noms frères, rendu lisible.
 *
 * Le nom de la contrainte vit dans la **cause**, jamais dans le message : celui
 * de Drizzle porte la requête qui a échoué. La leçon vient du nom de deck déjà
 * pris, qui ressortait en 500.
 */
function traduireConflit(err: unknown): never {
  const cause = (err as { cause?: { constraint_name?: string } }).cause;
  if (cause?.constraint_name === "deck_folders_sibling_name_uidx") {
    throw conflict("A folder by that name is already filed in the same place.");
  }
  throw err;
}

export async function listFolders(db: Database, ownerId: string): Promise<DeckFolder[]> {
  const byId = await charger(db, ownerId);
  return [...byId.values()]
    .map((row) => toFolder(row, byId))
    .sort((a, b) => a.path.join("/").localeCompare(b.path.join("/"), "fr"));
}

/**
 * Un dossier appartient-il bien à cette personne ?
 *
 * Le module deck s'en sert avant de ranger un deck : sans ce contrôle, on
 * pourrait déposer son deck dans le dossier d'un inconnu en devinant un UUID.
 */
export async function assertFolderOwned(
  db: Database,
  viewerId: string,
  folderId: string | null,
): Promise<void> {
  if (folderId === null) return;
  requireUuid(folderId);
  const [row] = await db
    .select({ id: deckFolders.id })
    .from(deckFolders)
    .where(and(eq(deckFolders.id, folderId), eq(deckFolders.userId, viewerId)))
    .limit(1);
  if (!row) throw notFound("Folder not found.");
}

export async function createFolder(
  db: Database,
  viewerId: string,
  input: { name: string; parentId?: string | null },
): Promise<DeckFolder> {
  const name = nomPropre(input.name);
  const parentId = input.parentId ?? null;

  if (parentId !== null) {
    requireUuid(parentId);
    const byId = await charger(db, viewerId);
    const parent = byId.get(parentId);
    if (!parent) throw notFound("Folder not found.");
    if (folderDepth(topologie(byId), parent.id) >= DECK_FOLDER_MAX_DEPTH) {
      throw invalidInput("That folder is already on the last level.");
    }
  }

  try {
    const [row] = await db
      .insert(deckFolders)
      .values({ userId: viewerId, parentId, name })
      .returning();
    if (!row) throw new Error("insertion sans résultat");
    return toFolder(row, await charger(db, viewerId));
  } catch (err) {
    traduireConflit(err);
  }
}

/**
 * Renommer un dossier, ou le déplacer.
 *
 * Les deux dans le même geste parce que la base les écrit dans la même ligne,
 * et que déplacer sans renommer est un `parentId` sans `name`.
 *
 * **Le déplacement est la partie difficile.** Un dossier ne peut pas passer
 * sous lui-même ni sous l'un de ses descendants — la branche disparaîtrait de
 * l'arbre sans que rien ne l'efface — et il emmène ses étages avec lui : c'est
 * la hauteur de **son sous-arbre**, et non lui seul, qui doit tenir sous la
 * limite.
 */
export async function updateFolder(
  db: Database,
  viewerId: string,
  folderId: string,
  input: { name?: string; parentId?: string | null },
): Promise<DeckFolder> {
  requireUuid(folderId);
  const byId = await charger(db, viewerId);
  const existant = byId.get(folderId);
  if (!existant) throw notFound("Folder not found.");

  const valeurs: { name?: string; parentId?: string | null; updatedAt: Date } = {
    updatedAt: new Date(),
  };
  if (input.name !== undefined) valeurs.name = nomPropre(input.name);

  if (input.parentId !== undefined) {
    const parentId = input.parentId;
    if (parentId === folderId) throw invalidInput("A folder cannot be filed inside itself.");

    if (parentId !== null) {
      requireUuid(parentId);
      if (!byId.has(parentId)) throw notFound("Folder not found.");

      /**
       * Les trois refus sont séparés parce que chacun a sa phrase. La question
       * « est-ce que ça tient ? » a une réponse d'un seul tenant côté écran
       * (`folderCanHost`) ; ici il faut dire **pourquoi** non.
       */
      const arbre = topologie(byId);
      if (folderIsInside(arbre, parentId, folderId)) {
        throw invalidInput("A folder cannot be filed inside one of its own.");
      }
      if (
        folderDepth(arbre, parentId) + folderSubtreeHeight(arbre, folderId) > DECK_FOLDER_MAX_DEPTH
      ) {
        throw invalidInput("That folder and its contents would go past the last level.");
      }
    }
    valeurs.parentId = parentId;
  }

  try {
    const [row] = await db
      .update(deckFolders)
      .set(valeurs)
      .where(and(eq(deckFolders.id, folderId), eq(deckFolders.userId, viewerId)))
      .returning();
    if (!row) throw notFound("Folder not found.");
    return toFolder(row, await charger(db, viewerId));
  } catch (err) {
    traduireConflit(err);
  }
}

/**
 * Effacer un dossier **sans effacer ce qu'il contient**.
 *
 * Ses sous-dossiers et ses decks remontent d'un étage. C'est la règle
 * d'ATEM-old, et la bonne : un dossier est un rangement, pas un propriétaire —
 * le jeter ne doit pas emporter des mois de construction. Sa base disait
 * pourtant l'inverse (`on delete cascade` sur le parent), et c'est elle qui
 * aurait gagné si une suppression était passée ailleurs que par ce service.
 *
 * Les trois écritures tiennent dans **une transaction** : à moitié faite, elle
 * laisserait des decks pointant sur un dossier disparu.
 */
export async function deleteFolder(
  db: Database,
  viewerId: string,
  folderId: string,
): Promise<void> {
  requireUuid(folderId);
  const [existant] = await db
    .select()
    .from(deckFolders)
    .where(and(eq(deckFolders.id, folderId), eq(deckFolders.userId, viewerId)))
    .limit(1);
  if (!existant) throw notFound("Folder not found.");

  const parentId = existant.parentId;
  const maintenant = new Date();

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(deckFolders)
        .set({ parentId, updatedAt: maintenant })
        .where(and(eq(deckFolders.userId, viewerId), eq(deckFolders.parentId, folderId)));

      await tx
        .update(decks)
        .set({ folderId: parentId, updatedAt: maintenant })
        .where(and(eq(decks.userId, viewerId), eq(decks.folderId, folderId)));

      await tx
        .delete(deckFolders)
        .where(and(eq(deckFolders.id, folderId), eq(deckFolders.userId, viewerId)));
    });
  } catch (err) {
    /**
     * Un enfant qui remonte peut heurter un homonyme à l'étage du dessus.
     *
     * On refuse plutôt que de renommer d'office : le nom appartient à celui qui
     * l'a écrit, et deux « Meta » côte à côte seraient sa surprise, pas son
     * choix.
     */
    const cause = (err as { cause?: { constraint_name?: string } }).cause;
    if (cause?.constraint_name === "deck_folders_sibling_name_uidx") {
      throw conflict("A folder inside it has the same name as a folder on the level above.");
    }
    throw err;
  }
}
