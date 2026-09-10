import { test } from "node:test";
import assert from "node:assert/strict";
import { requireJwtSecret, resetJwtSecretCache } from "./secret.js";

/**
 * La clé de signature est la seule chose qui empêche un tiers de forger une
 * session. ATEM-old avait un repli en dur écrit à trois endroits : une instance
 * déployée sans `JWT_SECRET` acceptait des jetons fabriqués par quiconque avait
 * lu le dépôt.
 *
 * Ces épreuves vérifient que le garde-fou refuse de démarrer plutôt que
 * d'avertir — un avertissement se lit une fois et s'oublie.
 */
function withSecret<T>(value: string | undefined, run: () => T): T {
  const previous = process.env.JWT_SECRET;
  resetJwtSecretCache();
  if (value === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = value;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previous;
    resetJwtSecretCache();
  }
}

test("une clé absente empêche le démarrage", () => {
  withSecret(undefined, () => {
    assert.throws(() => requireJwtSecret(), /JWT_SECRET est requise/);
  });
});

test("une clé trop courte est refusée", () => {
  // Huit caractères satisfont « la variable existe » tout en restant devinables.
  withSecret("court123", () => {
    assert.throws(() => requireJwtSecret(), /32 au minimum/);
  });
});

test("l'ancien repli d'ATEM-old est refusé nommément", () => {
  // Il fait plus de 32 caractères : seule une comparaison explicite l'arrête.
  // Le refuser par son nom évite qu'il revienne par copier-coller.
  withSecret("atem_dev_secret_key_change_me_in_prod", () => {
    assert.throws(() => requireJwtSecret(), /ancienne valeur de repli/);
  });
});

test("une clé valide est acceptée, puis mise en cache", () => {
  const secret = "une-cle-de-signature-de-plus-de-trente-deux-caracteres";
  withSecret(secret, () => {
    assert.equal(requireJwtSecret(), secret);
    // Le cache évite de relire l'environnement à chaque requête.
    delete process.env.JWT_SECRET;
    assert.equal(requireJwtSecret(), secret);
  });
});
