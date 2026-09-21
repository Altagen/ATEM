/**
 * The administrator, as the configuration declares it.
 *
 * Ange, 2026-09-21: one administrator, with credentials “as code”, written in
 * the configuration. No fallback, like `JWT_SECRET`: an instance without an
 * administrator cannot close its registration or suspend anyone, and one with a
 * default password has an administrator anybody can be. So a missing value
 * stops the start, and says what to write.
 */
export type AdminConfig = { email: string; password: string; displayName: string };

const DEFAULT_NAME = "Admin";

export function requireAdminConfig(env: NodeJS.ProcessEnv = process.env): AdminConfig {
  const email = env.ATEM_ADMIN_EMAIL?.trim();
  const password = env.ATEM_ADMIN_PASSWORD;
  if (!email || !email.includes("@")) {
    throw new Error("ATEM_ADMIN_EMAIL is required: the address the administrator signs in with.");
  }
  if (!password) {
    throw new Error(
      "ATEM_ADMIN_PASSWORD is required: 16 characters or more, with an uppercase letter, " +
        "a lowercase letter, a digit and a special character.",
    );
  }
  const displayName = env.ATEM_ADMIN_NAME?.trim() || DEFAULT_NAME;
  if (displayName.length < 2 || displayName.length > 32) {
    throw new Error("ATEM_ADMIN_NAME must be 2 to 32 characters long.");
  }
  return { email, password, displayName };
}
