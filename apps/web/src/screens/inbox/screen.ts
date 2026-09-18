/**
 * The inbox screen — wiring.
 *
 * Answering a friend request goes through the community routes, the ones the
 * directory already uses: ATEM-old had a second pair under `/inbox`, which
 * could drift from the first without anything noticing.
 *
 * Opening the inbox marks what is in it as read — that is what opening it
 * means; the badge in the navigation follows.
 */
import { api, ApiError } from "../../platform/api.js";
import { t } from "../../platform/i18n/index.js";
import { refreshInbox } from "../../platform/navigation.js";
import { toast } from "../../platform/ui.js";
import { inboxState, type InboxItem } from "./state.js";
import { inboxHtml } from "./view.js";

export async function inboxScreen(
  root: HTMLElement,
  _params: URLSearchParams,
  signal: AbortSignal,
): Promise<void> {
  const state = inboxState();

  const reason = (err: unknown, fallback: string): string =>
    err instanceof ApiError ? err.message : fallback;

  function paint(): void {
    root.innerHTML = inboxHtml(state).toString();
    bind();
  }

  async function load(): Promise<void> {
    try {
      const answer = await api<{ items: InboxItem[]; unread: number }>("/inbox");
      state.items = answer.items;
      state.unread = answer.unread;
      state.failure = null;
    } catch (err) {
      state.items = [];
      state.failure = reason(err, t("The inbox could not be loaded."));
    }
  }

  async function act(id: string, run: () => Promise<void>, done: string): Promise<void> {
    if (state.busy.has(id)) return;
    state.busy.add(id);
    paint();
    try {
      await run();
      await load();
      toast(done, "success");
    } catch (err) {
      toast(reason(err, t("The request failed.")), "error");
    } finally {
      state.busy.delete(id);
      await refreshInbox();
      if (!signal.aborted) paint();
    }
  }

  function bind(): void {
    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-accept]")) {
      const who = button.dataset.accept!;
      const item = button.dataset.itemId!;
      button.addEventListener("click", () => void act(item,
        () => api(`/community/friends/${who}/accept`, { method: "POST" }),
        t("Friend request accepted.")));
    }

    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-decline]")) {
      const who = button.dataset.decline!;
      const item = button.dataset.itemId!;
      button.addEventListener("click", () => void act(item,
        () => api(`/community/friends/${who}`, { method: "DELETE" }),
        t("Friend request declined.")));
    }

    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-remove]")) {
      const id = button.dataset.remove!;
      button.addEventListener("click", () => void act(id,
        () => api(`/inbox/${id}`, { method: "DELETE" }),
        t("Notification removed.")));
    }
  }

  paint();
  await load();
  if (signal.aborted) return;
  paint();

  /**
   * Opening the inbox is reading it.
   *
   * The lines keep their unread mark for this visit — what was waiting is worth
   * seeing at a glance — but the badge goes: coming back to a screen you have
   * just read to find it still saying “3 waiting” is the classic small lie.
   */
  if (state.unread > 0) {
    try {
      await api("/inbox/read-all", { method: "POST" });
      state.unread = 0;
      await refreshInbox();
      if (!signal.aborted) paint();
    } catch {
      // A badge left standing is not worth a message: the next visit clears it.
    }
  }
}
