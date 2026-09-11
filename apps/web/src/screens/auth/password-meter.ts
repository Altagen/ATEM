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
  checkPasswordStrength, PASSWORD_CRITERIA, type PasswordStrengthResult,
} from "@atem/shared";
import { el } from "../../platform/ui.js";

export function mountPasswordMeter(host: HTMLElement, input: HTMLInputElement): void {
  const bar = el("span", { class: "pwd-meter-bar" });
  const meter = el("div", { class: "pwd-meter", "data-level": "0" }, [bar]);
  const label = el("p", { class: "pwd-meter-label muted" }, [t("Choisissez un mot de passe.")]);

  const items = PASSWORD_CRITERIA.map((criterion) => {
    const mark = el("span", { "aria-hidden": "true" }, ["○"]);
    const item = el("li", { class: "pwd-criterion" }, [mark, " ", criterion.label]);
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
      ? t("Choisissez un mot de passe.")
      : `Force : ${strength.label}`;

    for (const { criterion, item, mark } of items) {
      const met = strength[criterion.id] === true;
      item.classList.toggle("is-met", met);
      mark.textContent = met ? "✓" : "○";
    }
  }

  input.addEventListener("input", refresh);
  refresh();
}
