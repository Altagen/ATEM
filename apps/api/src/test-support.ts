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

export function jsonPost(
  app: ReturnType<typeof createTestApp>["app"],
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}
