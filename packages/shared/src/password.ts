/**
 * Password strength — **one rule, shared**.
 *
 * The server applies it on registration and on password change; the screen uses
 * it to draw its meter. It is the same function, not a copy: ATEM-old had four
 * diverging implementations — one on the server, two in the front, one in the
 * mock-up — held together by “mirror” tests checking they told the same story.
 *
 * They did not. The mock-up judged that a long phrase beats a short twisted
 * word: true in general, false here. A twenty-eight letter phrase without a
 * digit displayed “Solid” and was refused on submit. A screen that approves
 * what the server rejects is worse than a silent one.
 *
 * Requirement: **sixteen characters and the four families** — uppercase,
 * lowercase, digit, special character.
 */

/**
 * The level carries a **code**, not a label.
 *
 * It used to carry one — « Faible », « Moyen » — and the screen displayed it as
 * is: the meter therefore said “Force : Faible” to an English account. A rules
 * package has no business knowing the language of whoever reads it; the screen
 * translates the code.
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
 * The criteria, in the order the screen shows them — **by identifier**.
 *
 * Their label used to live here, in French, in a package the server imports
 * too. The screen now translates it from this identifier.
 */
export const PASSWORD_CRITERIA = [
  "hasMinLength",
  "hasUpper",
  "hasLower",
  "hasDigit",
  "hasSpecial",
] as const satisfies readonly (keyof PasswordStrengthResult)[];
