/**
 * The public API of the identity module — what other modules may call. Nobody
 * imports `./schema.js` or `./service.js` directly.
 */
export { attachViewer, requireViewer } from "./middleware.js";
export { getProfile, getPublicUser, type Profile, type PublicUser } from "./service.js";
export { identityRoutes } from "./routes.js";
