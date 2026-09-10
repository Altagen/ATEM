/**
 * L'API publique du module referential.
 *
 * `ensurePlaceholderPrint` et `upsertPrint` sont ici parce que `collection` et
 * `decks` en ont besoin — c'est précisément ce qui les dispense d'écrire
 * eux-mêmes dans `cards` et `card_prints`, comme ils le faisaient dans ATEM-old.
 */
export {
  ensurePlaceholderPrint,
  getCard,
  listPrintsForCard,
  printIndex,
  resolvePrintBySetCode,
  searchCardsByName,
  toCardDetail,
  upsertCard,
  upsertPrint,
  type CardDetail,
  type PrintIndex,
} from "./service.js";
export { referentialRoutes } from "./routes.js";
