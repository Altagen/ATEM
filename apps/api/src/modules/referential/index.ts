/**
 * L'API publique du module referential.
 *
 * `ensurePlaceholderPrint` et `upsertPrint` sont ici parce que `collection` et
 * `decks` en ont besoin — c'est précisément ce qui les dispense d'écrire
 * eux-mêmes dans `cards` et `card_prints`, comme ils le faisaient dans ATEM-old.
 */
export {
  cardsByPasscode,
  ensurePlaceholderPrint,
  getCard,
  listPrintsForCard,
  markUnidentified,
  printIndex,
  resolvePrintBySetCode,
  upsertCard,
  upsertPrint,
  type CardDetail,
  type PrintIndex,
} from "./service.js";
// La forme d'une ligne de carte appartient au schéma ; `deck` en a besoin pour
// nommer ce qu'il compose.
export { type CardRow } from "./schema.js";
export { referentialRoutes } from "./routes.js";
