/**
 * Les identifiants qui viennent du dehors.
 *
 * Une colonne `uuid` n'accepte pas n'importe quelle chaîne : PostgreSQL refuse
 * la comparaison, et ce refus remonte en **erreur interne** — un 500, avec la
 * requête échouée dans les journaux, pour ce qui n'est qu'une adresse mal
 * tapée. C'est la même famille que `?level=abc`, qui produisait un 500 là où un
 * filtre illisible ne mérite qu'un 400.
 *
 * On vérifie donc la forme avant d'interroger. Dans le service et non dans la
 * route : le service est appelable par autre chose qu'une route — un script,
 * une file, une épreuve — et sa garantie ne doit pas dépendre de qui l'appelle.
 */
import { invalidInput } from "./errors.js";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Rend l'identifiant, ou refuse la demande — jamais une erreur de base. */
export function requireUuid(value: string): string {
  if (!UUID.test(value)) throw invalidInput("Identifiant invalide.");
  return value;
}
