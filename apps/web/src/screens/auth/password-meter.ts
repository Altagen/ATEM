/**
 * La jauge de force du mot de passe.
 *
 * Balisage et classes repris de la maquette d'ATEM-old (`.pwd-*`, définies dans
 * `design/components.css`). La règle, elle, vient de `@atem/shared` — **la même
 * fonction que le serveur applique**, pas une copie.
 *
 * C'est le point qui comptait : ATEM-old avait quatre implémentations
 * divergentes de cette règle, et la maquette jugeait qu'une phrase longue vaut
 * mieux qu'un mot court et tordu. Vrai en général, faux ici : le serveur exige
 * seize caractères **et** les quatre familles. Une phrase de vingt-huit lettres
 * sans chiffre s'affichait « Solide » et se faisait refuser à l'envoi.
 *
 * La barre se remplit par quart, exactement comme le score du serveur : elle ne
 * peut donc pas annoncer « plein » sur un mot de passe qui sera refusé. Et
 * chaque critère porte son état — c'est la liste qui dit quoi corriger, la
 * barre ne fait que résumer.
 */
import { t } from "../../platform/i18n/index.js";
import {
  checkPasswordStrength, PASSWORD_CRITERIA,
  type PasswordLevel, type PasswordStrengthResult,
} from "@atem/shared";
import { el } from "../../platform/ui.js";

/**
 * Les libellés, ici et non dans `@atem/shared`.
 *
 * Le paquet partagé rend un code — `weak`, `hasUpper` — parce que le serveur
 * l'importe aussi et n'a que faire de la langue de qui lit. Les tables sont
 * lues à l'affichage : déclarées au niveau du module, elles figeraient la
 * langue du premier rendu.
 */
const STRENGTH_LABELS: Record<PasswordLevel, string> = {
  weak: "Weak",
  fair: "Fair",
  strong: "Strong",
  excellent: "Excellent",
};

const CRITERION_LABELS: Record<(typeof PASSWORD_CRITERIA)[number], string> = {
  hasMinLength: "At least 16 characters",
  hasUpper: "An uppercase letter (A-Z)",
  hasLower: "A lowercase letter (a-z)",
  hasDigit: "A digit (0-9)",
  hasSpecial: "A special character (!@#$…)",
};

export function mountPasswordMeter(host: HTMLElement, input: HTMLInputElement): void {
  const bar = el("span", { class: "pwd-meter-bar" });
  const meter = el("div", { class: "pwd-meter", "data-level": "0" }, [bar]);
  const label = el("p", { class: "pwd-meter-label muted" }, [t("Choose a password.")]);

  const items = PASSWORD_CRITERIA.map((criterion) => {
    const mark = el("span", { "aria-hidden": "true" }, ["○"]);
    const item = el("li", { class: "pwd-criterion" }, [mark, " ", t(CRITERION_LABELS[criterion])]);
    return { criterion, item, mark };
  });

  const list = el("ul", { class: "pwd-criteria" }, items.map((entry) => entry.item));
  host.append(el("div", { class: "pwd-strength" }, [meter, label, list]));

  /**
   * On modifie les nœuds existants plutôt que de redessiner : la jauge se met à
   * jour à chaque frappe, et reconstruire la liste à chaque touche ferait
   * clignoter les critères.
   */
  function refresh(): void {
    const value = input.value;
    const strength: PasswordStrengthResult = checkPasswordStrength(value);

    meter.setAttribute("data-level", String(strength.score));
    bar.style.width = `${strength.score * 25}%`;
    label.textContent = value.length === 0
      ? t("Choose a password.")
      : t("Strength: {level}", { level: t(STRENGTH_LABELS[strength.level]) });

    for (const { criterion, item, mark } of items) {
      const met = strength[criterion] === true;
      item.classList.toggle("is-met", met);
      mark.textContent = met ? "✓" : "○";
    }
  }

  input.addEventListener("input", refresh);
  refresh();
}
