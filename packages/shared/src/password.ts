/**
 * La force d'un mot de passe — **une seule règle, partagée**.
 *
 * Le serveur l'applique à l'inscription et au changement de mot de passe ;
 * l'écran s'en sert pour dessiner sa jauge. C'est la même fonction, pas une
 * copie : ATEM-old en avait quatre implémentations divergentes — une au
 * serveur, deux dans le front, une dans la maquette — tenues ensemble par des
 * tests « miroir » qui vérifiaient qu'elles racontaient la même chose.
 *
 * Elles ne la racontaient pas. La maquette jugeait qu'une phrase longue vaut
 * mieux qu'un mot court et tordu : vrai en général, faux ici. Une phrase de
 * vingt-huit lettres sans chiffre s'affichait « Solide » et se faisait refuser
 * à l'envoi. Un écran qui approuve ce que le serveur rejette est pire qu'un
 * écran muet.
 *
 * Exigence : **seize caractères et les quatre familles** — majuscule,
 * minuscule, chiffre, caractère spécial.
 */
/**
 * Le niveau porte un **code**, pas un libellé.
 *
 * Il en portait un — « Faible », « Moyen » — et l'écran l'affichait tel quel :
 * la jauge disait donc « Force : Faible » à un compte anglais. Un paquet de
 * règles n'a pas à connaître la langue de qui le lit ; l'écran traduit le code.
 */
export type PasswordLevel = "weak" | "fair" | "strong" | "excellent";

export type PasswordStrengthResult = {
  score: 0 | 1 | 2 | 3 | 4;
  level: PasswordLevel;
  hasMinLength: boolean; // >= 16
  hasUpper: boolean;
  hasLower: boolean;
  hasDigit: boolean;
  hasSpecial: boolean;
  isValid: boolean; // hasMinLength && hasUpper && hasLower && hasDigit && hasSpecial
};

export function checkPasswordStrength(password: string): PasswordStrengthResult {
  const p = password || "";
  const hasMinLength = p.length >= 16;
  const hasUpper = /[A-Z]/.test(p);
  const hasLower = /[a-z]/.test(p);
  const hasDigit = /[0-9]/.test(p);
  const hasSpecial = /[^A-Za-z0-9]/.test(p);

  const categoriesCount = (hasUpper ? 1 : 0) + (hasLower ? 1 : 0) + (hasDigit ? 1 : 0) + (hasSpecial ? 1 : 0);
  const isValid = hasMinLength && categoriesCount === 4;

  let score: 0 | 1 | 2 | 3 | 4 = 0;
  let level: PasswordLevel = "weak";

  if (p.length === 0) {
    score = 0;
    level = "weak";
  } else if (p.length < 12 || categoriesCount < 2) {
    score = 1;
    level = "weak";
  } else if (!isValid) {
    if (p.length >= 14 && categoriesCount >= 3) {
      score = 3;
      level = "strong";
    } else {
      score = 2;
      level = "fair";
    }
  } else {
    // Length >= 16 and all 4 ANSSI categories present
    score = 4;
    level = "excellent";
  }

  return {
    score,
    level,
    hasMinLength,
    hasUpper,
    hasLower,
    hasDigit,
    hasSpecial,
    isValid,
  };
}

/**
 * Les critères, dans l'ordre où l'écran les montre — **par identifiant**.
 *
 * Leur libellé vivait ici, en français, dans un paquet que le serveur importe
 * aussi. L'écran le traduit maintenant depuis cet identifiant.
 */
export const PASSWORD_CRITERIA = [
  "hasMinLength",
  "hasUpper",
  "hasLower",
  "hasDigit",
  "hasSpecial",
] as const satisfies readonly (keyof PasswordStrengthResult)[];
