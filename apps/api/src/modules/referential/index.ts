/**
 * The public API of the referential module.
 *
 * `ensurePlaceholderPrint` and `upsertPrint` are here because `collection` and
 * `deck` need them — which is precisely what spares them writing into `cards`
 * and `card_prints` themselves, as they did in the earlier prototype.
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
// The shape of a card row belongs to the schema; `deck` needs it to name what
// it composes.
export { type CardRow } from "./schema.js";
export { referentialRoutes } from "./routes.js";
export { mediaRoutes } from "./media-routes.js";
export { publicImageUrls } from "./media.js";
