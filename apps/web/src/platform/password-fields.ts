/**
 * What every password field shares: an eye to see what one types, and a
 * confirmation that says it differs while it is typed.
 *
 * Asked for by the maintainer on 2026-09-22. The eye is installed on **every** password
 * field of the application by one observer rather than by each screen: a form
 * added tomorrow gets it without anyone remembering to, and the screens that
 * repaint their markup get it back at every paint.
 */
import { t } from "./i18n/index.js";
import { el } from "./ui.js";

function reveal(input: HTMLInputElement): void {
  if (input.dataset.revealable !== undefined) return;
  input.dataset.revealable = "";
  const button = el("button", {
    type: "button",
    class: "password-reveal",
    "aria-pressed": "false",
    "aria-label": t("Show the password"),
    title: t("Show the password"),
  }, ["👁️"]);
  button.addEventListener("click", () => {
    const shown = input.type === "password";
    input.type = shown ? "text" : "password";
    button.setAttribute("aria-pressed", String(shown));
    const label = shown ? t("Hide the password") : t("Show the password");
    button.setAttribute("aria-label", label);
    button.title = label;
    button.textContent = shown ? "🙈" : "👁️";
    input.focus();
  });
  const wrap = el("span", { class: "password-field" });
  input.replaceWith(wrap);
  wrap.append(input, button);
}

export function installPasswordReveal(): void {
  const sweep = (): void => {
    for (const input of document.querySelectorAll<HTMLInputElement>('input[type="password"]:not([data-revealable])')) {
      reveal(input);
    }
  };
  sweep();
  new MutationObserver(sweep).observe(document.body, { childList: true, subtree: true });
}

/**
 * The confirmation says it differs **as it is typed**, not only on submit —
 * The earlier prototype waited for the button, and one found out after typing both twice.
 *
 * Silent while the confirmation is empty, or still a beginning of the password:
 * “different” is not true yet of what is only unfinished.
 */
export function watchConfirmation(password: HTMLInputElement, confirm: HTMLInputElement): void {
  const note = el("p", { class: "field-mismatch", role: "status" });
  (confirm.closest(".password-field") ?? confirm).after(note);
  const check = (): void => {
    const typed = confirm.value;
    const differs = typed !== "" && !(password.value.startsWith(typed) && typed.length < password.value.length)
      && typed !== password.value;
    confirm.classList.toggle("is-mismatch", differs);
    confirm.setAttribute("aria-invalid", String(differs));
    note.textContent = differs ? t("The two passwords do not match.") : "";
  };
  password.addEventListener("input", check);
  confirm.addEventListener("input", check);
}
