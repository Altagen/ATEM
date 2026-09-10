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
import { api, ApiError, type PublicUser } from "../../platform/api.js";
import { navigate } from "../../platform/router.js";
import { setUser } from "../../platform/session.js";
import { el, toast } from "../../platform/ui.js";
import { mountPasswordMeter } from "./password-meter.js";

type Mode = "login" | "register";

function authHeader(): HTMLElement {
  return el("header", { class: "landing-header" }, [
    el("a", { class: "landing-brand", href: "/", "aria-label": "Accueil ATEM" }, [
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

export function authScreen(mode: Mode) {
  return (root: HTMLElement, params: URLSearchParams) => {
    const isRegister = mode === "register";
    const next = params.get("suite") ?? "/collection";

    root.className = "auth-page";

    const email = el("input", {
      type: "email",
      autocomplete: "username",
      placeholder: "nom@exemple.com",
    });
    const password = el("input", {
      type: "password",
      autocomplete: isRegister ? "new-password" : "current-password",
      placeholder: isRegister ? "Min. 16 caractères…" : "••••••••",
    });
    const confirm = el("input", {
      type: "password",
      autocomplete: "new-password",
      placeholder: "Retapez le mot de passe",
    });
    const displayName = el("input", {
      type: "text",
      autocomplete: "nickname",
      placeholder: "Votre pseudo de duelliste",
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
      isRegister ? "Créer mon compte" : "Se connecter",
    ]);

    const form = el("form", { class: "auth-form", novalidate: "" });

    const passwordGroup = fieldGroup(
      isRegister ? "reg-password" : "login-password",
      "Mot de passe",
      password,
      isRegister ? "16 caractères au minimum" : undefined,
    );

    if (isRegister) {
      form.append(
        fieldGroup("reg-name", "Pseudo", displayName),
        fieldGroup("reg-email", "Adresse e-mail", email),
        passwordGroup,
        fieldGroup("reg-confirm", "Confirmation du mot de passe", confirm),
        submit,
      );
      mountPasswordMeter(passwordGroup, password);
    } else {
      form.append(
        fieldGroup("login-email", "Adresse e-mail", email),
        passwordGroup,
        submit,
      );
    }

    const card = el("section", { class: isRegister ? "auth-card is-wide" : "auth-card" }, [
      el("h1", { class: "auth-card-title" }, [
        isRegister ? "Créer un compte" : "Se connecter",
      ]),
      el("p", { class: "auth-subtitle muted" }, [
        isRegister
          ? "Création de compte duelliste"
          : "Advanced Tactical Engine for MatchMaking",
      ]),
      errorBanner,
      form,
      el("p", { class: "auth-toggle muted" }, [
        isRegister ? "Déjà un compte ? " : "Nouveau sur ATEM ? ",
        el("a", { class: "auth-link-btn", href: isRegister ? "/connexion" : "/inscription" }, [
          isRegister ? "Se connecter" : "Créer un compte",
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
        ? "Un instant…"
        : isRegister
          ? "Créer mon compte"
          : "Se connecter";
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      errorBanner.textContent = "";

      if (isRegister && password.value !== confirm.value) {
        errorBanner.textContent = "Les deux mots de passe ne correspondent pas.";
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
        toast(`Bienvenue, ${user.displayName}.`, "success");
        navigate(next, { replace: true });
      } catch (err) {
        errorBanner.textContent =
          err instanceof ApiError ? err.message : "Le serveur est injoignable.";
        setBusy(false);
      }
    });

    (isRegister ? displayName : email).focus();
  };
}
