/**
 * The public API of the identity module — what other modules may call. Nobody
 * imports `./schema.js` or `./service.js` directly.
 */
export { attachViewer, requireViewer } from "./middleware.js";
export {
  activePlayerId, getProfile, getPublicUser, listProfiles,
  type Duellist, type Profile, type PublicUser,
} from "./service.js";
export { identityRoutes } from "./routes.js";
