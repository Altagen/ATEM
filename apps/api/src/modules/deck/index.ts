/** The public API of the deck module. */
export { deckRoutes } from "./routes.js";
export { listFolders, type DeckFolder } from "./folders.js";
export {
  deckNameOf, getDeck, listDecks, type DeckCardEntry, type DeckDetail, type DeckSummary,
} from "./service.js";
