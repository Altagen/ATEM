/**
 * Signing in and registering.
 *
 * The markup is that of the earlier prototype's approved mock-up — not a reinterpretation.
 * The mock-up is authoritative over the ported version: it deliberately fixes
 * three things the front had let slip (an `h1` rather than an `h2`, a real link
 * rather than a clickable `div`, and no inline styles where the port had
 * eighteen).
 *
 * Not carried over: the demo accounts block. It pre-fills credentials that do
 * not exist here — that is fabricated data.
 */
import { t } from "../../platform/i18n/index.js";
import { api, ApiError, type PublicUser } from "../../platform/api.js";
import { navigate } from "../../platform/router.js";
import { setUser } from "../../platform/session.js";
import { el, toast } from "../../platform/ui.js";
import { watchConfirmation } from "../../platform/password-fields.js";
import { mountPasswordMeter } from "../shared/password-meter.js";

type Mode = "login" | "register";

function authHeader(): HTMLElement {
  return el("header", { class: "landing-header" }, [
    el("a", { class: "landing-brand", href: "/", "aria-label": t("ATEM home") }, [
      el("span", { class: "landing-logo" }, ["ATEM"]),
    ]),
  ]);
}

function fieldGroup(
  id: string,
  label: string,
  input: HTMLInputElement,
  hint?: string,
): HTMLElement {
  input.id = id;
  input.className = "auth-input";
  const labelNode = el("label", { for: id }, [label]);
  if (hint) {
    labelNode.append(" ", el("span", { class: "field-hint" }, [hint]));
  }
  return el("div", { class: "auth-field-group" }, [labelNode, input]);
}

/**
 * The post-sign-in destination, reduced to a path of our own.
 *
 * `?next=` comes from the URL: it is input, not trusted data.
 * `history.pushState` already refuses another origin — but by **throwing**,
 * which left the sign-in half done on a forged link. A single leading `/`,
 * never two (`//elsewhere.example` is another origin, and so is `/\` once the
 * URL is normalised), and otherwise we fall back to where we go anyway.
 */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/")) return "/collection";
  if (raw.startsWith("//") || raw.startsWith("/\\")) return "/collection";
  return raw;
}

/**
 * Registration closed by the administrator: the page says so, and offers the
 * way that remains — asking them — rather than a form bound to be refused.
 */
function closedRegistration(root: HTMLElement): void {
  root.append(
    authHeader(),
    el("div", { class: "landing-container" }, [
      el("div", { class: "auth-main-wrapper" }, [
        el("section", { class: "auth-card" }, [
          el("h1", { class: "auth-card-title" }, [t("Create an account")]),
          el("p", { class: "auth-subtitle muted", "data-registration-closed": "" }, [
            t("Registration is closed on this instance: ask its administrator for an account."),
          ]),
          el("p", { class: "auth-toggle muted" }, [
            `${t("Already have an account?")} `,
            el("a", { class: "auth-link-btn", href: "/login" }, [t("Sign in")]),
          ]),
        ]),
      ]),
    ]),
  );
}

export function authScreen(mode: Mode) {
  return async (root: HTMLElement, params: URLSearchParams) => {
    const isRegister = mode === "register";
    const next = safeNext(params.get("next"));

    root.className = "auth-page";

    if (isRegister) {
      // Asked before drawing: if the answer does not come, the form is shown
      // and the server's own refusal will say the same thing on submit.
      const open = await api<{ open: boolean }>("/auth/registration")
        .then((answer) => answer.open)
        .catch(() => true);
      if (!open) {
        closedRegistration(root);
        return;
      }
    }

    const email = el("input", {
      type: "email",
      autocomplete: "username",
      placeholder: "name@example.com",
    });
    const password = el("input", {
      type: "password",
      autocomplete: isRegister ? "new-password" : "current-password",
      placeholder: isRegister ? t("Min. 16 characters…") : "••••••••",
    });
    const confirm = el("input", {
      type: "password",
      autocomplete: "new-password",
      placeholder: t("Type the password again"),
    });
    const displayName = el("input", {
      type: "text",
      autocomplete: "nickname",
      placeholder: t("Your duellist name"),
    });

    /**
     * The error banner is rendered **once, empty**, and only its text changes.
     * The `.auth-error-banner:empty` rule makes it disappear on its own:
     * nothing is inserted into or removed from the DOM, so nothing jumps.
     */
    const errorBanner = el("p", {
      class: "auth-error-banner",
      role: "alert",
      "data-auth-error": "",
    });

    const submit = el("button", { type: "submit", class: "auth-submit-btn" }, [
      isRegister ? t("Create my account") : t("Sign in"),
    ]);

    const form = el("form", { class: "auth-form", novalidate: "" });

    const passwordGroup = fieldGroup(
      isRegister ? "reg-password" : "login-password",
      t("Password"),
      password,
      isRegister ? t("16 characters minimum") : undefined,
    );

    if (isRegister) {
      form.append(
        fieldGroup("reg-name", t("Display name"), displayName),
        fieldGroup("reg-email", t("Email address"), email),
        passwordGroup,
        fieldGroup("reg-confirm", t("Confirm password"), confirm),
        submit,
      );
      mountPasswordMeter(passwordGroup, password);
      watchConfirmation(password, confirm);
    } else {
      form.append(
        fieldGroup("login-email", t("Email address"), email),
        passwordGroup,
        submit,
      );
    }

    const card = el("section", { class: isRegister ? "auth-card is-wide" : "auth-card" }, [
      el("h1", { class: "auth-card-title" }, [
        isRegister ? t("Create an account") : t("Sign in"),
      ]),
      el("p", { class: "auth-subtitle muted" }, [
        isRegister
          ? t("Create a duellist account")
          : t("Advanced Tactical Engine for MatchMaking"),
      ]),
      errorBanner,
      form,
      el("p", { class: "auth-toggle muted" }, [
        isRegister ? `${t("Already have an account?")} ` : `${t("New to ATEM?")} `,
        el("a", { class: "auth-link-btn", href: isRegister ? "/login" : "/register" }, [
          isRegister ? t("Sign in") : t("Create an account"),
        ]),
      ]),
    ]);

    root.append(
      authHeader(),
      el("div", { class: "landing-container" }, [
        el("div", { class: "auth-main-wrapper" }, [card]),
      ]),
    );

    /**
     * While submitting, the fields and the button are disabled through their
     * native property, and the button's label changes. Nothing is redrawn: what
     * was typed survives the round trip.
     */
    function setBusy(busy: boolean): void {
      for (const control of form.querySelectorAll("input, button")) {
        (control as HTMLInputElement).disabled = busy;
      }
      submit.textContent = busy
        ? t("One moment…")
        : isRegister
          ? t("Create my account")
          : t("Sign in");
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      errorBanner.textContent = "";

      if (isRegister && password.value !== confirm.value) {
        errorBanner.textContent = t("The two passwords do not match.");
        confirm.focus();
        return;
      }

      setBusy(true);
      try {
        const body = isRegister
          ? { email: email.value, password: password.value, displayName: displayName.value }
          : { email: email.value, password: password.value };
        const { user } = await api<{ user: PublicUser }>(
          isRegister ? "/auth/register" : "/auth/login",
          { method: "POST", body },
        );
        setUser(user);
        // A welcome is not a success: green is reserved for what has just been
        // saved — a card added, a note kept. Arriving at your collection wears
        // the house gold.
        toast(t("Welcome, {name}.", { name: user.displayName }));
        navigate(next, { replace: true });
      } catch (err) {
        errorBanner.textContent =
          err instanceof ApiError ? err.message : t("The server is unreachable.");
        setBusy(false);
      }
    });

    (isRegister ? displayName : email).focus();
  };
}
