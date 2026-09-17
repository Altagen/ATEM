/**
 * The settings screen — wiring.
 *
 * Behaviour taken from ATEM-old's `settings/app.ts`, onto routes built for it:
 * rename (`PATCH /auth/me`), email change behind the password
 * (`POST /auth/me/email`), password change
 * (`POST /auth/me/password`), erasing the collection (`DELETE /collection`) and
 * deleting the account (`DELETE /auth/me`).
 */
import { api, ApiError } from "../../platform/api.js";
import { t } from "../../platform/i18n/index.js";
import { renderNavigation } from "../../platform/navigation.js";
import { navigate } from "../../platform/router.js";
import { knownUser, setUser } from "../../platform/session.js";
import { toast } from "../../platform/ui.js";
import { mountPasswordMeter } from "../shared/password-meter.js";
import {
  settingsState, type AccountDetails, type ImportRecord, type ImportResult, type SettingsView,
} from "./state.js";
import { deletionReady, emailChangeReady, emailMismatch, settingsHtml } from "./view.js";
import {
  checkPasswordStrength, isCsvExportFormat, LIMITS, parseCollectionFile,
} from "@atem/shared";

/** How long an erase can still be cancelled. ATEM-old's five seconds, kept. */
const CLEAR_DELAY_S = 5;

export async function settingsScreen(
  root: HTMLElement,
  _params: URLSearchParams,
  signal: AbortSignal,
): Promise<void> {
  const state = settingsState();
  let clearTimer: number | null = null;

  const reason = (err: unknown, fallback: string): string =>
    err instanceof ApiError ? err.message : fallback;

  function paint(): void {
    root.innerHTML = settingsHtml(state).toString();
    bind();
  }

  async function loadAccount(): Promise<void> {
    try {
      const { account } = await api<{ account: AccountDetails }>("/auth/me/account");
      state.account = account;
    } catch (err) {
      toast(reason(err, t("Your account could not be loaded.")), "error");
    }
  }

  async function loadOwnedCount(): Promise<void> {
    try {
      // One row is enough: what is wanted is the total the list reports.
      const { total } = await api<{ total: number }>("/collection?limit=1");
      state.ownedCount = total;
    } catch {
      // The danger zone shows a dash rather than a number it did not measure.
      state.ownedCount = null;
    }
  }

  async function loadHistory(): Promise<void> {
    try {
      const { items } = await api<{ items: ImportRecord[] }>("/collection/imports");
      state.history = items;
    } catch (err) {
      state.history = [];
      toast(reason(err, t("The import history could not be loaded.")), "error");
    }
  }

  function show(view: SettingsView): void {
    state.view = view;
    // The history is read when it is opened, so it includes an import just made.
    if (view === "history") {
      state.history = null;
      void loadHistory().then(() => {
        if (!signal.aborted && state.view === "history") paint();
      });
    }
    paint();
    // A panel opened from the menu starts at its top, not where the menu was.
    window.scrollTo({ top: 0 });
  }

  function closeModal(): void {
    state.modal = null;
    state.clearWord = "";
    state.deletion = { phrase: "", password: "", acknowledged: false };
    state.emailChange = { email: "", confirm: "", password: "" };
    paint();
  }

  /** Stops a pending erase — nothing has been sent, so there is nothing to undo. */
  function cancelClear(): void {
    if (clearTimer !== null) window.clearInterval(clearTimer);
    clearTimer = null;
    state.clearCountdown = null;
    paint();
    toast(t("The collection was not erased."), "success");
  }

  function startClear(): void {
    state.modal = null;
    state.clearWord = "";
    state.clearCountdown = CLEAR_DELAY_S;
    paint();

    clearTimer = window.setInterval(() => {
      if (state.clearCountdown === null) return;
      state.clearCountdown -= 1;
      if (state.clearCountdown > 0) {
        paint();
        return;
      }
      if (clearTimer !== null) window.clearInterval(clearTimer);
      clearTimer = null;
      state.clearCountdown = null;
      void (async () => {
        try {
          const { removed } = await api<{ removed: number }>("/collection", { method: "DELETE" });
          state.ownedCount = 0;
          toast(
            removed === 1
              ? t("1 printing erased from your collection.")
              : t("{n} printings erased from your collection.", { n: removed }),
            "success",
          );
        } catch (err) {
          toast(reason(err, t("The collection could not be erased.")), "error");
        }
        paint();
      })();
    }, 1000);
  }

  function bind(): void {
    root.querySelectorAll<HTMLElement>("[data-target-view]").forEach((button) => {
      button.addEventListener("click", () => {
        show(button.dataset.targetView as SettingsView);
      });
    });

    // ── Account ───────────────────────────────────────────────────────────
    root.querySelector("#form-display-name")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const displayName = root.querySelector<HTMLInputElement>("#input-display-name")?.value.trim() ?? "";
      if (displayName === state.account?.displayName) return;
      try {
        const { user } = await api<{ user: AccountDetails }>("/auth/me", {
          method: "PATCH",
          body: { displayName },
        });
        // The navigation shows the name, and is only rebuilt on the next screen
        // change or the minute's poll: without this, the top bar and the account
        // sheet kept the old name after a successful rename. Found by the test.
        setUser(user);
        renderNavigation();
        await loadAccount();
        toast(t("Renamed to {name} #{tag}.", { name: user.displayName, tag: user.tag }), "success");
      } catch (err) {
        toast(reason(err, t("The rename failed.")), "error");
      }
      paint();
    });

    root.querySelector("#btn-open-email")?.addEventListener("click", () => {
      state.modal = "email";
      paint();
      root.querySelector<HTMLInputElement>("#input-new-email")?.focus();
    });

    const refreshEmail = (): void => {
      const submit = root.querySelector<HTMLButtonElement>("#form-email button[type=submit]");
      if (submit) submit.disabled = !emailChangeReady(state);
      const mismatch = root.querySelector<HTMLElement>("#email-mismatch");
      if (mismatch) mismatch.hidden = !emailMismatch(state);
    };
    for (const [id, field] of [
      ["#input-new-email", "email"], ["#input-confirm-email", "confirm"], ["#input-email-password", "password"],
    ] as const) {
      const input = root.querySelector<HTMLInputElement>(id);
      input?.addEventListener("input", () => {
        state.emailChange[field] = input.value;
        refreshEmail();
      });
    }

    root.querySelector("#form-email")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!emailChangeReady(state)) return;
      try {
        await api("/auth/me/email", {
          method: "POST",
          body: { email: state.emailChange.email.trim(), password: state.emailChange.password },
        });
        await loadAccount();
        closeModal();
        toast(t("Email address updated."), "success");
      } catch (err) {
        toast(reason(err, t("The email address could not be changed.")), "error");
      }
    });

    // ── Password ──────────────────────────────────────────────────────────
    const newPassword = root.querySelector<HTMLInputElement>("#input-new-password");
    const meterHost = root.querySelector<HTMLElement>("#password-meter-host");
    if (newPassword && meterHost) mountPasswordMeter(meterHost, newPassword);

    root.querySelector("#form-password")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const current = root.querySelector<HTMLInputElement>("#input-current-password")?.value ?? "";
      const next = newPassword?.value ?? "";
      const confirm = root.querySelector<HTMLInputElement>("#input-confirm-password")?.value ?? "";

      // Refused here first because the answer is visible without asking anyone:
      // the server applies the very same rule and would refuse it too.
      if (next !== confirm) {
        toast(t("The two new passwords do not match."), "error");
        return;
      }
      if (!checkPasswordStrength(next).isValid) {
        toast(t("The password does not meet the required criteria."), "error");
        return;
      }
      try {
        await api("/auth/me/password", {
          method: "POST",
          body: { currentPassword: current, newPassword: next },
        });
        toast(t("Password changed. Your other sessions are signed out."), "success");
        show("root");
      } catch (err) {
        toast(reason(err, t("The password could not be changed.")), "error");
      }
    });

    // ── Export ────────────────────────────────────────────────────────────
    // A radio button, not a field: repainting on change loses no typing.
    root.querySelectorAll<HTMLInputElement>('input[name="export-format"]').forEach((radio) => {
      radio.addEventListener("change", () => {
        if (isCsvExportFormat(radio.value)) state.exportFormat = radio.value;
        paint();
      });
    });

    // ── Import ────────────────────────────────────────────────────────────
    const fileInput = root.querySelector<HTMLInputElement>("#import-file");
    fileInput?.addEventListener("change", async () => {
      const chosen = fileInput.files?.[0];
      if (!chosen) return;
      // Refused before reading: the server refuses it too, and reading five
      // megabytes into the page only to be told so is a slow answer.
      if (chosen.size > LIMITS.csvImport.maxBytes) {
        toast(t("The file is too large (5 MB at most)."), "error");
        return;
      }
      const text = await chosen.text();
      state.importFile = { name: chosen.name, text, preview: parseCollectionFile(text) };
      state.importResult = null;
      paint();
    });

    root.querySelectorAll<HTMLInputElement>('input[name="import-mode"]').forEach((radio) => {
      radio.addEventListener("change", () => {
        state.importMode = radio.value === "replace" ? "replace" : "merge";
        paint();
      });
    });

    root.querySelector("#btn-import-run")?.addEventListener("click", async () => {
      const file = state.importFile;
      if (!file || state.importBusy) return;
      state.importBusy = true;
      paint();
      try {
        const query = new URLSearchParams({ mode: state.importMode, filename: file.name });
        state.importResult = await api<ImportResult>(`/collection/import?${query}`, {
          method: "POST",
          text: { content: file.text, contentType: "text/plain; charset=utf-8" },
        });
        state.importFile = null;
        await loadOwnedCount();
        toast(t("Import finished."), "success");
      } catch (err) {
        toast(reason(err, t("The import failed.")), "error");
      }
      state.importBusy = false;
      paint();
    });

    // ── Danger zone ───────────────────────────────────────────────────────
    root.querySelector("#btn-open-clear")?.addEventListener("click", () => {
      state.modal = "clear";
      paint();
    });
    root.querySelector("#btn-open-delete")?.addEventListener("click", () => {
      state.modal = "delete";
      paint();
    });
    root.querySelector("#btn-cancel-clear")?.addEventListener("click", cancelClear);
    root.querySelector("#settings-modal-cancel")?.addEventListener("click", closeModal);
    root.querySelector("#settings-modal-backdrop")?.addEventListener("click", closeModal);

    /**
     * Typing updates the button, **not the screen**.
     *
     * A repaint on every keystroke rebuilds the field and throws the caret out
     * of it. The button's `disabled` is the only thing that depends on what is
     * typed, so that is all that changes — ATEM-old's way, for the same reason.
     */
    const clearWord = root.querySelector<HTMLInputElement>("#input-clear-word");
    clearWord?.addEventListener("input", () => {
      state.clearWord = clearWord.value;
      const submit = root.querySelector<HTMLButtonElement>("#form-clear button[type=submit]");
      if (submit) submit.disabled = state.clearWord.trim().toLowerCase() !== "collection";
    });
    root.querySelector("#form-clear")?.addEventListener("submit", (event) => {
      event.preventDefault();
      if (state.clearWord.trim().toLowerCase() === "collection") startClear();
    });

    const refreshDelete = (): void => {
      const submit = root.querySelector<HTMLButtonElement>("#form-delete button[type=submit]");
      if (submit) submit.disabled = !deletionReady(state);
    };
    const phrase = root.querySelector<HTMLInputElement>("#input-delete-phrase");
    phrase?.addEventListener("input", () => {
      state.deletion.phrase = phrase.value;
      refreshDelete();
    });
    const password = root.querySelector<HTMLInputElement>("#input-delete-password");
    password?.addEventListener("input", () => {
      state.deletion.password = password.value;
      refreshDelete();
    });
    const ack = root.querySelector<HTMLInputElement>("#input-delete-ack");
    ack?.addEventListener("change", () => {
      state.deletion.acknowledged = ack.checked;
      refreshDelete();
    });

    root.querySelector("#form-delete")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!deletionReady(state)) return;
      try {
        await api("/auth/me", { method: "DELETE", body: { password: state.deletion.password } });
        setUser(null);
        toast(t("Your account has been deleted."), "success");
        navigate("/login", { replace: true });
      } catch (err) {
        toast(reason(err, t("The account could not be deleted.")), "error");
      }
    });
  }

  /** Escape closes the window first, then leaves a panel for the menu. */
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape") return;
      if (state.modal !== null) closeModal();
      else if (state.view !== "root") show("root");
    },
    { signal },
  );

  // Leaving the screen must not leave an erase running behind it.
  signal.addEventListener("abort", () => {
    if (clearTimer !== null) window.clearInterval(clearTimer);
  });

  // A guest has no settings: the router already requires a session, this only
  // guards against a session that expired between two navigations.
  if (!knownUser()) {
    navigate("/login", { replace: true });
    return;
  }

  paint();
  await Promise.all([loadAccount(), loadOwnedCount()]);
  if (!signal.aborted) paint();
}
