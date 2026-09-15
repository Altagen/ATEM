/**
 * Connexion et inscription.
 *
 * Le balisage est celui de la maquette validée d'ATEM-old — pas une
 * réinterprétation. La maquette y fait autorité sur la version portée : elle
 * corrige délibérément trois choses que le front avait laissées filer (un `h1`
 * plutôt qu'un `h2`, un vrai lien plutôt qu'un `div` cliquable, et aucun style
 * en ligne là où le porté en comptait dix-huit).
 *
 * Non repris : le bloc de comptes de démonstration. Il préremplit des
 * identifiants qui n'existent pas ici — c'est de la donnée fabriquée.
 */
import { t } from "../../platform/i18n/index.js";
import { api, ApiError, type PublicUser } from "../../platform/api.js";
import { navigate } from "../../platform/router.js";
import { setUser } from "../../platform/session.js";
import { el, toast } from "../../platform/ui.js";
import { mountPasswordMeter } from "./password-meter.js";

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
 * La destination d'après connexion, ramenée à un chemin de chez nous.
 *
 * `?suite=` vient de l'URL : c'est une entrée, pas une donnée de confiance.
 * `history.pushState` refuse déjà une autre origine — mais en **levant**, ce qui
 * laissait la connexion à moitié faite sur un lien forgé. Un seul `/` en tête,
 * jamais deux (`//ailleurs.example` est une autre origine, `/\` aussi une fois
 * l'URL normalisée), et on retombe sinon là où l'on va de toute façon.
 */
function safeSuite(raw: string | null): string {
  if (!raw || !raw.startsWith("/")) return "/collection";
  if (raw.startsWith("//") || raw.startsWith("/\\")) return "/collection";
  return raw;
}

export function authScreen(mode: Mode) {
  return (root: HTMLElement, params: URLSearchParams) => {
    const isRegister = mode === "register";
    const next = safeSuite(params.get("suite"));

    root.className = "auth-page";

    const email = el("input", {
      type: "email",
      autocomplete: "username",
      placeholder: "nom@exemple.com",
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
     * Le bandeau d'erreur est rendu **une fois, vide**, et seul son texte
     * change. La règle `.auth-error-banner:empty` le fait disparaître tout
     * seul : rien n'est inséré ni retiré du DOM, donc rien ne saute.
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
        el("a", { class: "auth-link-btn", href: isRegister ? "/connexion" : "/inscription" }, [
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
     * Pendant l'envoi, les champs et le bouton sont désactivés par leur
     * propriété native, et le libellé du bouton change. Rien n'est redessiné :
     * ce qui a été saisi survit à l'aller-retour.
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
        // Un accueil n'est pas un succès : le vert est réservé à ce qui vient
        // d'être enregistré — une carte ajoutée, une note gardée. L'arrivée sur
        // sa collection porte le doré de la maison.
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
