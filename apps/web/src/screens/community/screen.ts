/**
 * The community screen — wiring.
 *
 * The server is asked for the search (`GET /community/duellists?q=`); the chips
 * filter the list already held, because each one carries its count.
 *
 * A relation gesture repaints from what the server answers, never from what the
 * screen hoped: `friendStatus` comes back with every answer.
 */
import { api, ApiError } from "../../platform/api.js";
import { t } from "../../platform/i18n/index.js";
import { toast } from "../../platform/ui.js";
import { communityState, type CommunityFilter, type Duellist, type FriendStatus } from "./state.js";
import { communityHtml } from "./view.js";

/** How long typing settles before the server is asked. */
const SEARCH_DELAY_MS = 250;

export async function communityScreen(
  root: HTMLElement,
  _params: URLSearchParams,
  signal: AbortSignal,
): Promise<void> {
  const state = communityState();
  let searchTimer: number | null = null;

  const reason = (err: unknown, fallback: string): string =>
    err instanceof ApiError ? err.message : fallback;

  function paint(): void {
    root.innerHTML = communityHtml(state).toString();
    bind();
  }

  async function loadDuellists(): Promise<void> {
    try {
      const query = state.search.trim() ? `?q=${encodeURIComponent(state.search.trim())}` : "";
      const answer = await api<{ items: Duellist[]; truncated: boolean }>(`/community/duellists${query}`);
      state.duellists = answer.items;
      state.truncated = answer.truncated;
      state.failure = null;
    } catch (err) {
      state.duellists = [];
      state.failure = reason(err, t("The duellists could not be loaded."));
    }
  }

  async function loadBlocked(): Promise<void> {
    try {
      const { items } = await api<{ items: Duellist[] }>("/community/blocks");
      state.blocked = items;
    } catch (err) {
      state.blocked = [];
      toast(reason(err, t("The blocked duellists could not be loaded.")), "error");
    }
  }

  /**
   * One relation gesture: send it, then take the state the server answers.
   *
   * The row goes inert while it is under way, so a double click does not send
   * two requests — the unique pair would refuse the second anyway, but the
   * screen should not have to rely on that to stay honest.
   */
  async function act(
    id: string,
    path: string,
    method: "POST" | "DELETE",
    done: (status: FriendStatus) => string,
  ): Promise<void> {
    if (state.busy.has(id)) return;
    state.busy.add(id);
    paint();
    try {
      const answer = await api<{ friendStatus?: FriendStatus }>(path, { method });
      const status = answer.friendStatus ?? "none";
      const one = state.duellists?.find((item) => item.id === id);
      if (one) one.friendStatus = status;
      toast(done(status), "success");
    } catch (err) {
      toast(reason(err, t("The request failed.")), "error");
      // The list may be stale — a block, a suspension: read it again.
      await loadDuellists();
    } finally {
      state.busy.delete(id);
      if (!signal.aborted) paint();
    }
  }

  const nameOf = (id: string): string =>
    [...(state.duellists ?? []), ...(state.blocked ?? [])]
      .find((one) => one.id === id)?.displayName ?? t("This duellist");

  function bind(): void {
    const search = root.querySelector<HTMLInputElement>("#duellist-search");
    search?.addEventListener("input", () => {
      state.search = search.value;
      if (searchTimer !== null) window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => {
        void loadDuellists().then(() => {
          if (signal.aborted) return;
          paint();
          // Typing must not lose the caret: it is put back where it was.
          const field = root.querySelector<HTMLInputElement>("#duellist-search");
          field?.focus();
          field?.setSelectionRange(field.value.length, field.value.length);
        });
      }, SEARCH_DELAY_MS);
    });

    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-filter]")) {
      button.addEventListener("click", () => {
        state.filter = button.dataset.filter as CommunityFilter;
        // The blocked list is read when opened, so it shows a block just made.
        if (state.filter === "blocked") {
          state.blocked = null;
          void loadBlocked().then(() => {
            if (!signal.aborted && state.filter === "blocked") paint();
          });
        }
        paint();
      });
    }

    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-add]")) {
      const id = button.dataset.add!;
      button.addEventListener("click", () => void act(id, `/community/friends/${id}`, "POST", (status) =>
        status === "friends"
          ? t("You are now friends with {name}.", { name: nameOf(id) })
          : t("Friend request sent to {name}.", { name: nameOf(id) })));
    }

    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-accept]")) {
      const id = button.dataset.accept!;
      button.addEventListener("click", () => void act(id, `/community/friends/${id}/accept`, "POST",
        () => t("You are now friends with {name}.", { name: nameOf(id) })));
    }

    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-remove]")) {
      const id = button.dataset.remove!;
      button.addEventListener("click", () => void act(id, `/community/friends/${id}`, "DELETE",
        () => t("Nothing links you to {name} any more.", { name: nameOf(id) })));
    }

    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-unblock]")) {
      const id = button.dataset.unblock!;
      button.addEventListener("click", () => {
        const name = nameOf(id);
        void (async () => {
          state.busy.add(id);
          paint();
          try {
            await api(`/community/blocks/${id}`, { method: "DELETE" });
            toast(t("{name} is unblocked.", { name }), "success");
            await Promise.all([loadBlocked(), loadDuellists()]);
          } catch (err) {
            toast(reason(err, t("The request failed.")), "error");
          } finally {
            state.busy.delete(id);
            if (!signal.aborted) paint();
          }
        })();
      });
    }
  }

  signal.addEventListener("abort", () => {
    if (searchTimer !== null) window.clearTimeout(searchTimer);
  });

  paint();
  await loadDuellists();
  if (signal.aborted) return;
  paint();
}
