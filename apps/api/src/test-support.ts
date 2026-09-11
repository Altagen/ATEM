/**
 * Le socle des tests d'intégration.
 *
 * Le pool de connexions est fermé après la dernière suite : sans ça, la boucle
 * d'événements ne se vide jamais et le lanceur reste suspendu sans rien dire —
 * un symptôme pénible à diagnostiquer quand on ne l'a jamais vu.
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
 * Une adresse email jamais vue.
 *
 * Les tests partagent une base : dépendre d'une adresse fixe ferait échouer le
 * second à cause du premier, et l'ordre d'exécution deviendrait significatif.
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
 * Une requête JSON, quel que soit le verbe.
 *
 * Les épreuves de route ne portaient que sur `POST` — ce qui suffisait tant que
 * seule l'authentification en avait. Un module qui expose `PUT`, `PATCH` et
 * `DELETE` a besoin de les éprouver aussi : c'est là que vit la question de
 * savoir **au nom de qui** on écrit.
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
 * Un compte tout neuf, et le cookie de sa session.
 *
 * Passer par la route plutôt que par le service : c'est la session telle que le
 * navigateur la reçoit qu'on veut éprouver, cookie compris.
 */
export async function freshSession(app: TestApp, prefix: string) {
  const email = freshEmail(prefix);
  const response = await jsonPost(app, "/auth/register", {
    email,
    password: "Un-Mot-De-Passe-1!",
    displayName: `Testeur ${prefix}`,
  });
  const cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
  const { user } = (await response.json()) as { user: { id: string } };
  return { cookie, userId: user.id, email };
}
