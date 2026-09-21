/**
 * The public API of the identity module — what other modules may call. Nobody
 * imports `./schema.js` or `./service.js` directly.
 */
export { attachViewer, requireAdmin, requireViewer } from "./middleware.js";
export {
  activePlayerId, getProfile, getPublicUser, listProfiles, visibilityOf,
  type Duellist, type Profile, type PublicUser, type Visibilities,
} from "./service.js";
export {
  accountCounts, createAccountAsAdmin, deleteAccountAsAdmin, ensureAdministrator, listAccounts,
  registrationOpen, setRegistrationOpen, setSuspended, type AdminAccount,
} from "./service.js";
export { identityRoutes } from "./routes.js";
