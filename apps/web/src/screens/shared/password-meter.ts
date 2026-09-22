/**
 * The password strength meter.
 *
 * Markup and classes taken from the earlier prototype's mock-up (`.pwd-*`, defined in
 * `design/components.css`). The rule itself comes from `@atem/shared` — **the
 * same function the server applies**, not a copy.
 *
 * That was the point that mattered: The earlier prototype had four diverging implementations
 * of this rule, and the mock-up judged that a long phrase beats a short twisted
 * word. True in general, false here: the server requires sixteen characters
 * **and** the four families. A twenty-eight letter phrase without a digit
 * displayed “Solid” and was refused on submit.
 *
 * The bar fills by quarters, exactly like the server's score: it therefore
 * cannot announce “full” on a password that will be refused. And each criterion
 * carries its own state — the list says what to fix, the bar only summarises.
 */
import { t } from "../../platform/i18n/index.js";
import {
  checkPasswordStrength, PASSWORD_CRITERIA,
  type PasswordLevel, type PasswordStrengthResult,
} from "@atem/shared";
import { el } from "../../platform/ui.js";

/**
 * The labels, here rather than in `@atem/shared`.
 *
 * The shared package returns a code — `weak`, `hasUpper` — because the server
 * imports it too and has no use for the reader's language. The tables are read
 * at display time: declared at module level, they would freeze the language of
 * the first render.
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
   * We modify the existing nodes rather than redrawing: the meter updates on
   * every keystroke, and rebuilding the list on each key would make the
   * criteria flicker.
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
