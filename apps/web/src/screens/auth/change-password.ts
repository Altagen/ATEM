/**
 * The first sign-in of an account the administrator opened.
 *
 * Its password is the administrator's choice, so they know it: before anything
 * else, the owner chooses their own. The server refuses every other route
 * until then; this screen is the only one the router leads to, with the
 * sign-in page's look — it is still, in effect, getting in.
 */
import { api, ApiError, type PublicUser } from "../../platform/api.js";
import { t } from "../../platform/i18n/index.js";
import { signOutNow } from "../../platform/navigation.js";
import { navigate } from "../../platform/router.js";
import { homeOf, setUser } from "../../platform/session.js";
import { el, toast } from "../../platform/ui.js";
import { mountPasswordMeter } from "../shared/password-meter.js";

function field(id: string, label: string, input: HTMLInputElement): HTMLElement {
  input.id = id;
  input.className = "auth-input";
  return el("div", { class: "auth-field-group" }, [el("label", { for: id }, [label]), input]);
}

export async function changePasswordScreen(root: HTMLElement): Promise<void> {
  root.className = "auth-page";

  const current = el("input", { type: "password", autocomplete: "current-password" });
  const fresh = el("input", {
    type: "password", autocomplete: "new-password", placeholder: t("Min. 16 characters…"),
  });
  const confirm = el("input", {
    type: "password", autocomplete: "new-password", placeholder: t("Type the password again"),
  });
  const errorBanner = el("p", { class: "auth-error-banner", role: "alert" });
  const submit = el("button", { type: "submit", class: "auth-submit-btn" }, [t("Choose this password")]);
  const freshGroup = field("new-password", t("New password"), fresh);

  const form = el("form", { class: "auth-form", novalidate: "" }, [
    field("temporary-password", t("Password given by the administrator"), current),
    freshGroup,
    field("confirm-password", t("Confirm password"), confirm),
    submit,
  ]);
  mountPasswordMeter(freshGroup, fresh);

  const leave = el("button", { type: "button", class: "auth-link-btn" }, [t("Sign out")]);
  leave.addEventListener("click", () => void signOutNow());

  root.append(
    el("header", { class: "landing-header" }, [el("span", { class: "landing-logo" }, ["ATEM"])]),
    el("div", { class: "landing-container" }, [
      el("div", { class: "auth-main-wrapper" }, [
        el("section", { class: "auth-card is-wide" }, [
          el("h1", { class: "auth-card-title" }, [t("Choose your password")]),
          el("p", { class: "auth-subtitle muted" }, [
            t("Your account was opened by the administrator, who chose its first password. Choose your own to start."),
          ]),
          errorBanner,
          form,
          el("p", { class: "auth-toggle muted" }, [leave]),
        ]),
      ]),
    ]),
  );

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorBanner.textContent = "";
    if (fresh.value !== confirm.value) {
      errorBanner.textContent = t("The two passwords do not match.");
      confirm.focus();
      return;
    }
    for (const control of form.querySelectorAll("input, button")) (control as HTMLInputElement).disabled = true;
    try {
      const { user } = await api<{ user: PublicUser }>("/auth/me/password", {
        method: "POST",
        body: { currentPassword: current.value, newPassword: fresh.value },
      });
      setUser(user);
      toast(t("Welcome, {name}.", { name: user.displayName }));
      navigate(homeOf(user), { replace: true });
    } catch (err) {
      errorBanner.textContent = err instanceof ApiError ? err.message : t("The server is unreachable.");
      for (const control of form.querySelectorAll("input, button")) (control as HTMLInputElement).disabled = false;
    }
  });

  current.focus();
}
