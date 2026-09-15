/**
 * The base of the integration tests.
 *
 * The connection pool is closed after the last suite: without that, the event
 * loop never drains and the runner hangs without a word — a painful symptom to
 * diagnose when you have never seen it.
 */
import { after } from "node:test";
import { createApp } from "./app.js";
import { createDatabase } from "./db/client.js";

export function createTestApp() {
  const { db, sql } = createDatabase();
  after(async () => {
    await sql.end();
  });
  return { app: createApp(db), db };
}

/**
 * An email address never seen before.
 *
 * Tests share one database: depending on a fixed address would make the second
 * fail because of the first, and execution order would become significant.
 */
export const freshEmail = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@exemple.test`;

type TestApp = ReturnType<typeof createTestApp>["app"];

export function jsonPost(
  app: TestApp,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return jsonRequest(app, "POST", path, body, headers);
}

/**
 * A JSON request, whatever the verb.
 *
 * Route tests only covered `POST` — which was enough while only authentication
 * had any. A module exposing `PUT`, `PATCH` and `DELETE` needs those tested
 * too: that is where the question of **on whose behalf** we write lives.
 */
export function jsonRequest(
  app: TestApp,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return app.request(path, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/**
 * A brand-new account, and its session cookie.
 *
 * Going through the route rather than the service: it is the session as the
 * browser receives it that we want to test, cookie included.
 */
export async function freshSession(app: TestApp, prefix: string) {
  const email = freshEmail(prefix);
  const response = await jsonPost(app, "/auth/register", {
    email,
    password: "Un-Mot-De-Passe-1!",
    displayName: `Tester ${prefix}`,
  });
  const cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
  const { user } = (await response.json()) as { user: { id: string } };
  return { cookie, userId: user.id, email };
}
