/**
 * The console — wiring.
 *
 * Each gesture repaints from what the server answers, never from what the
 * screen hoped; the figures are read again after anything that moves them.
 */
import { api, ApiError } from "../../platform/api.js";
import { t } from "../../platform/i18n/index.js";
import { toast } from "../../platform/ui.js";
import { mountPasswordMeter } from "../shared/password-meter.js";
import { adminState, type AdminAccount, type AdminLogEntry, type AdminTab, type Overview } from "./state.js";
import { adminHtml } from "./view.js";

/** A page of a console list, as the server answers it. */
type Page<T> = { items: T[]; nextCursor: string | null };

/** How long typing settles before the server is asked. */
const SEARCH_DELAY_MS = 250;

export async function adminScreen(
  root: HTMLElement,
  _params: URLSearchParams,
  signal: AbortSignal,
): Promise<void> {
  const state = adminState();
  let searchTimer: number | null = null;

  const reason = (err: unknown, fallback: string): string =>
    err instanceof ApiError ? err.message : fallback;

  function paint(): void {
    root.innerHTML = adminHtml(state).toString();
    bind();
  }

  async function loadOverview(): Promise<void> {
    try {
      state.overview = await api<Overview>("/admin/overview");
      state.failure = null;
    } catch (err) {
      state.failure = reason(err, t("The server is unreachable."));
    }
  }

  /**
   * The accounts, from the top — or the next page after what is shown. After
   * a gesture the list is read again from the top: what is shown must be what
   * is there, and a longer list read again would cost more than it shows.
   */
  async function loadAccounts(more = false): Promise<void> {
    try {
      const params = new URLSearchParams();
      if (state.search.trim()) params.set("q", state.search.trim());
      if (more && state.accountsCursor) params.set("cursor", state.accountsCursor);
      const page = await api<Page<AdminAccount>>(`/admin/accounts?${params}`);
      state.accounts = more ? [...(state.accounts ?? []), ...page.items] : page.items;
      state.accountsCursor = page.nextCursor;
      state.failure = null;
    } catch (err) {
      if (!more) state.accounts = [];
      state.failure = reason(err, t("The server is unreachable."));
    }
  }

  async function loadLog(more = false): Promise<void> {
    try {
      const query = more && state.logCursor ? `?cursor=${encodeURIComponent(state.logCursor)}` : "";
      const page = await api<Page<AdminLogEntry>>(`/admin/log${query}`);
      state.log = more ? [...(state.log ?? []), ...page.items] : page.items;
      state.logCursor = page.nextCursor;
    } catch (err) {
      if (!more) state.log = [];
      state.failure = reason(err, t("The server is unreachable."));
    }
  }

  async function open(which: AdminTab): Promise<void> {
    state.tab = which;
    paint();
    if (which === "overview") await loadOverview();
    if (which === "accounts") await loadAccounts();
    if (which === "log") await loadLog();
    if (!signal.aborted) paint();
  }

  /** A gesture on one account, then the list and the figures as they now are. */
  async function onAccount(id: string, work: () => Promise<unknown>, done: string): Promise<void> {
    if (state.busy.has(id)) return;
    state.busy.add(id);
    paint();
    try {
      await work();
      toast(done, "success");
    } catch (err) {
      toast(reason(err, t("The request failed.")), "error");
    } finally {
      state.busy.delete(id);
      await Promise.all([loadAccounts(), loadOverview()]);
      if (!signal.aborted) paint();
    }
  }

  const labelOf = (id: string): string => {
    const account = state.accounts?.find((one) => one.id === id);
    return account ? `${account.displayName}#${account.tag}` : t("This account");
  };

  function bind(): void {
    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-tab]")) {
      button.addEventListener("click", () => void open(button.dataset.tab as AdminTab));
    }

    for (const radio of root.querySelectorAll<HTMLInputElement>('input[name="registration"]')) {
      radio.addEventListener("change", () => {
        const wanted = radio.value === "open";
        void (async () => {
          try {
            const answer = await api<{ registrationOpen: boolean }>("/admin/settings", {
              method: "PATCH", body: { registrationOpen: wanted },
            });
            toast(answer.registrationOpen ? t("Registration is open.") : t("Registration is closed."), "success");
          } catch (err) {
            toast(reason(err, t("The request failed.")), "error");
          }
          await loadOverview();
          if (!signal.aborted) paint();
        })();
      });
    }

    const search = root.querySelector<HTMLInputElement>("#account-search");
    search?.addEventListener("input", () => {
      state.search = search.value;
      if (searchTimer !== null) window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => {
        void loadAccounts().then(() => {
          if (signal.aborted) return;
          paint();
          const field = root.querySelector<HTMLInputElement>("#account-search");
          field?.focus();
          field?.setSelectionRange(field.value.length, field.value.length);
        });
      }, SEARCH_DELAY_MS);
    });

    root.querySelector("#btn-more-accounts")?.addEventListener("click", () => {
      void loadAccounts(true).then(() => { if (!signal.aborted) paint(); });
    });
    root.querySelector("#btn-more-log")?.addEventListener("click", () => {
      void loadLog(true).then(() => { if (!signal.aborted) paint(); });
    });

    root.querySelector("#btn-create-open")?.addEventListener("click", () => {
      state.draft = { email: "", displayName: "", password: "" };
      paint();
      root.querySelector<HTMLInputElement>("#create-email")?.focus();
    });
    root.querySelector("#btn-create-cancel")?.addEventListener("click", () => {
      state.draft = null;
      paint();
    });
    // The same meter as at sign-up: the server applies the same rule.
    const temporary = root.querySelector<HTMLInputElement>("#create-password");
    const meterHost = root.querySelector<HTMLElement>("#create-password-meter");
    if (temporary && meterHost) mountPasswordMeter(meterHost, temporary);

    const form = root.querySelector<HTMLFormElement>("#form-create-account");
    form?.addEventListener("input", () => {
      if (!state.draft) return;
      state.draft.email = root.querySelector<HTMLInputElement>("#create-email")?.value ?? "";
      state.draft.displayName = root.querySelector<HTMLInputElement>("#create-name")?.value ?? "";
      state.draft.password = root.querySelector<HTMLInputElement>("#create-password")?.value ?? "";
    });
    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      const draft = state.draft;
      if (!draft) return;
      void (async () => {
        try {
          const { account } = await api<{ account: AdminAccount }>("/admin/accounts", {
            method: "POST", body: draft,
          });
          state.draft = null;
          toast(t("{name} can now sign in.", { name: `${account.displayName}#${account.tag}` }), "success");
          await Promise.all([loadAccounts(), loadOverview()]);
        } catch (err) {
          // The form stays as typed: the refusal says what to change.
          toast(reason(err, t("The request failed.")), "error");
        }
        if (!signal.aborted) paint();
      })();
    });

    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-suspend]")) {
      const id = button.dataset.suspend!;
      button.addEventListener("click", () => void onAccount(id,
        () => api(`/admin/accounts/${id}/suspend`, { method: "POST" }),
        t("{name} is suspended.", { name: labelOf(id) })));
    }
    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-restore]")) {
      const id = button.dataset.restore!;
      button.addEventListener("click", () => void onAccount(id,
        () => api(`/admin/accounts/${id}/restore`, { method: "POST" }),
        t("{name} is restored.", { name: labelOf(id) })));
    }
    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-delete]")) {
      button.addEventListener("click", () => {
        state.deleting = state.accounts?.find((one) => one.id === button.dataset.delete) ?? null;
        paint();
        root.querySelector<HTMLButtonElement>("#btn-delete-cancel")?.focus();
      });
    }
    const closeDelete = (): void => {
      state.deleting = null;
      paint();
    };
    root.querySelector("#btn-delete-cancel")?.addEventListener("click", closeDelete);
    root.querySelector("#admin-modal-backdrop")?.addEventListener("click", closeDelete);
    root.querySelector("#btn-delete-confirm")?.addEventListener("click", () => {
      const account = state.deleting;
      if (!account) return;
      state.deleting = null;
      void onAccount(account.id,
        () => api(`/admin/accounts/${account.id}`, { method: "DELETE" }),
        t("{name} is deleted.", { name: `${account.displayName}#${account.tag}` }));
    });
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.deleting) {
      state.deleting = null;
      paint();
    }
  }, { signal });
  signal.addEventListener("abort", () => {
    if (searchTimer !== null) window.clearTimeout(searchTimer);
  });

  await open("overview");
}
