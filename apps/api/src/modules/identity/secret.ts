/**
 * La clé de signature des jetons — une seule lecture, aucune valeur de repli.
 *
 * ATEM-old avait un repli en dur écrit à trois endroits. Une instance déployée
 * sans `JWT_SECRET` acceptait donc des jetons forgés par quiconque a lu le
 * dépôt. Le nom de la constante annonçait le danger sans l'empêcher : un
 * garde-fou qui compte sur la vigilance n'en est pas un.
 *
 * La longueur minimale ferme la porte d'à côté — une clé de huit caractères
 * satisfait « la variable existe » tout en restant devinable.
 */
const MIN_LENGTH = 32;

/** L'ancien repli d'ATEM-old. Le refuser nommément évite qu'il revienne par copie. */
const HISTORICAL_FALLBACK = "atem_dev_secret_key_change_me_in_prod";

let cached: string | null = null;

export function requireJwtSecret(): string {
  if (cached) return cached;
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error(
      "JWT_SECRET est requise. Générez-en une : openssl rand -base64 32",
    );
  }
  if (secret === HISTORICAL_FALLBACK) {
    throw new Error(
      "JWT_SECRET vaut l'ancienne valeur de repli, publiée dans un dépôt. " +
        "Générez-en une autre : openssl rand -base64 32",
    );
  }
  if (secret.length < MIN_LENGTH) {
    throw new Error(
      `JWT_SECRET fait ${secret.length} caractères, ${MIN_LENGTH} au minimum. ` +
        "Générez-en une : openssl rand -base64 32",
    );
  }

  cached = secret;
  return cached;
}

/** Tests : la clé est relue au prochain appel. */
export function resetJwtSecretCache(): void {
  cached = null;
}
