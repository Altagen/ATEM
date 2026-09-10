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
export type PasswordStrengthResult = {
  score: 0 | 1 | 2 | 3 | 4;
  label: "Faible" | "Moyen" | "Fort" | "Excellent";
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
  let label: "Faible" | "Moyen" | "Fort" | "Excellent" = "Faible";

  if (p.length === 0) {
    score = 0;
    label = "Faible";
  } else if (p.length < 12 || categoriesCount < 2) {
    score = 1;
    label = "Faible";
  } else if (!isValid) {
    if (p.length >= 14 && categoriesCount >= 3) {
      score = 3;
      label = "Fort";
    } else {
      score = 2;
      label = "Moyen";
    }
  } else {
    // Length >= 16 and all 4 ANSSI categories present
    score = 4;
    label = "Excellent";
  }

  return {
    score,
    label,
    hasMinLength,
    hasUpper,
    hasLower,
    hasDigit,
    hasSpecial,
    isValid,
  };
}

/** Les critères, dans l'ordre où l'écran les montre. */
export const PASSWORD_CRITERIA = [
  { id: "hasMinLength", label: "Au moins 16 caractères" },
  { id: "hasUpper", label: "Une majuscule (A-Z)" },
  { id: "hasLower", label: "Une minuscule (a-z)" },
  { id: "hasDigit", label: "Un chiffre (0-9)" },
  { id: "hasSpecial", label: "Un caractère spécial (!@#$…)" },
] as const satisfies readonly { id: keyof PasswordStrengthResult; label: string }[];
