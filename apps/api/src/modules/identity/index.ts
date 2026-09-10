/**
 * L'API publique du module identity — ce que les autres modules ont le droit
 * d'appeler. Personne n'importe `./schema.js` ni `./service.js` directement.
 */
export { attachViewer, requireAdmin, requireViewer, type Viewer } from "./middleware.js";
export { getPublicUser, type PublicUser } from "./service.js";
export { identityRoutes } from "./routes.js";
