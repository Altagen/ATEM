/**
 * Les bornes, en un seul endroit.
 *
 * ATEM-old a vécu la dérive que ce fichier empêche : la même limite décidée à
 * trois endroits différents, avec trois valeurs, si bien que le compteur de
 * l'interface affichait vert sur une saisie que l'API refusait.
 *
 * Une borne manquait aussi complètement — la quantité d'un exemplaire en
 * collection n'avait aucun plafond, là où les scanlistes plafonnaient à 1000.
 * Un fichier CSV avec `quantity=999999999` passait.
 */
export const LIMITS = {
  password: { min: 16, max: 512 },
  displayName: { min: 2, max: 32 },
  email: { max: 254 },
  setCode: { max: 32 },
  deckName: { max: 60 },
  deckNotes: { max: 2000 },
  /** Par ligne de collection comme par ligne de scanliste — même plafond. */
  quantity: { min: 0, max: 1000 },
  csvImport: { maxBytes: 5 * 1024 * 1024 },
  scanlist: { maxLines: 2000 },
} as const;
