/**
 * The duels screen — wiring.
 *
 * `/duels` lists what one has played or been invited to; `/duels?duel=<id>`
 * opens one. Every gesture takes the state the server answers, never what the
 * screen hoped: a duel is written by two people, and the other one may have
 * moved first.
 */
import { api, ApiError } from "../../platform/api.js";
import { t } from "../../platform/i18n/index.js";
import { refreshInbox } from "../../platform/navigation.js";
import { navigate } from "../../platform/router.js";
import { knownUser } from "../../platform/session.js";
import { toast } from "../../platform/ui.js";
import type { Duellist } from "../community/state.js";
import { duelState, type DeckChoice, type Duel, type DuelDetail } from "./state.js";
import { detailHtml, listHtml } from "./view.js";

/** Life points both duellists start on, unless a turn says otherwise. */
const STARTING_LIFE = 8000;

export async function duelScreen(
  root: HTMLElement,
  params: URLSearchParams,
  signal: AbortSignal,
): Promise<void> {
  const state = duelState();
  const duelId = params.get("duel");

  const reason = (err: unknown, fallback: string): string =>
    err instanceof ApiError ? err.message : fallback;

  function paint(): void {
    root.innerHTML = (duelId ? detailHtml(state) : listHtml(state)).toString();
    bind();
  }

  async function loadList(): Promise<void> {
    try {
      const { items } = await api<{ items: Duel[] }>("/duels");
      state.duels = items;
      state.failure = null;
    } catch (err) {
      state.duels = [];
      state.failure = reason(err, t("The duels could not be loaded."));
    }
  }

  async function loadDuel(): Promise<void> {
    if (!duelId) return;
    try {
      state.open = await api<DuelDetail>(`/duels/${duelId}`);
      state.failure = null;
    } catch (err) {
      state.open = null;
      state.failure = reason(err, t("This duel could not be opened."));
    }
  }

  /** The friends one can invite, and one's own decks — read when a window opens. */
  async function loadChoices(): Promise<void> {
    if (state.friends === null) {
      try {
        // The friends route, not the directory: the directory answers a bounded
        // page of the whole instance, where a friend may simply not appear.
        const { items } = await api<{ items: Duellist[] }>("/community/friends");
        state.friends = items;
      } catch {
        state.friends = [];
      }
    }
    if (state.decks === null) {
      try {
        const { items } = await api<{ items: DeckChoice[] }>("/decks");
        state.decks = items.map((deck) => ({ id: deck.id, name: deck.name }));
      } catch {
        state.decks = [];
      }
    }
  }

  function closeModals(): void {
    state.invite = null;
    state.result = null;
    state.turn = null;
    state.deckPick = null;
    state.busy = false;
    paint();
  }

  /**
   * One gesture: send it, reload what it changed, say what happened.
   *
   * **The caller reads its fields before calling**, because this repaints to
   * show the gesture under way — and a repaint rebuilds the window's inputs
   * from the state, losing what was typed. Measured on 2026-09-18: a turn
   * recorded 8000 life points when 5000 had been typed.
   */
  async function act(run: () => Promise<void>, done: string): Promise<void> {
    if (state.busy) return;
    state.busy = true;
    paint();
    try {
      await run();
      toast(done, "success");
    } catch (err) {
      toast(reason(err, t("The request failed.")), "error");
    } finally {
      state.busy = false;
      await refreshInbox();
      if (!signal.aborted) paint();
    }
  }

  const value = (id: string): string =>
    root.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)?.value.trim() ?? "";

  function bindModals(): void {
    root.querySelector("#duel-modal-cancel")?.addEventListener("click", closeModals);
    root.querySelector("#duel-modal-backdrop")?.addEventListener("click", closeModals);

    root.querySelector("#form-invite")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const guestId = value("invite-guest");
      if (!guestId) return;
      const date = value("invite-date");
      const deckId = value("invite-deck") || null;
      void act(async () => {
        const duel = await api<Duel>("/duels", {
          method: "POST",
          body: {
            guestId,
            playedOn: date ? new Date(`${date}T12:00:00`).toISOString() : undefined,
            deckId,
          },
        });
        state.invite = null;
        navigate(`/duels?duel=${duel.id}`);
      }, t("Invitation sent."));
    });

    root.querySelector("#form-result")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const hostScore = Number(value("result-host"));
      const guestScore = Number(value("result-guest"));
      const note = value("result-note") || null;
      if (!Number.isInteger(hostScore) || !Number.isInteger(guestScore)) {
        toast(t("A score is a whole number of wins."), "error");
        return;
      }
      void act(async () => {
        await api(`/duels/${duelId}/result`, {
          method: "POST",
          body: { hostScore, guestScore, note },
        });
        state.result = null;
        await loadDuel();
      }, t("Result recorded."));
    });

    root.querySelector("#form-turn")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const turn = state.turn;
      if (!turn) return;
      const written = {
        number: turn.number,
        playerId: value("turn-player"),
        hostLife: Number(value("turn-host")),
        guestLife: Number(value("turn-guest")),
        note: value("turn-note") || null,
      };
      void act(async () => {
        await api(`/duels/${duelId}/turns`, { method: "PUT", body: written });
        state.turn = null;
        await loadDuel();
      }, t("Turn written."));
    });

    root.querySelector("#form-duel-deck")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const deckId = value("duel-deck") || null;
      void act(async () => {
        await api(`/duels/${duelId}/deck`, { method: "PUT", body: { deckId } });
        state.deckPick = null;
        await loadDuel();
      }, t("Deck saved."));
    });
  }

  function bind(): void {
    bindModals();

    root.querySelector("#btn-invite")?.addEventListener("click", () => {
      void (async () => {
        await loadChoices();
        if (signal.aborted) return;
        state.invite = {
          guestId: state.friends?.[0]?.id ?? "",
          playedOn: new Date().toISOString().slice(0, 10),
          deckId: "",
        };
        paint();
      })();
    });

    root.querySelector("#btn-accept")?.addEventListener("click", () => {
      void act(async () => {
        await api(`/duels/${duelId}/accept`, { method: "POST" });
        await loadDuel();
      }, t("The duel is on."));
    });

    root.querySelector("#btn-drop")?.addEventListener("click", () => {
      void act(async () => {
        await api(`/duels/${duelId}`, { method: "DELETE" });
        navigate("/duels");
      }, t("The duel was called off."));
    });

    root.querySelector("#btn-result")?.addEventListener("click", () => {
      state.result = { hostScore: "", guestScore: "", note: "" };
      paint();
    });

    root.querySelector("#btn-deck")?.addEventListener("click", () => {
      void (async () => {
        await loadChoices();
        if (signal.aborted) return;
        const duel = state.open;
        const mine = duel?.isHost ? duel.host : duel?.guest;
        state.deckPick = { deckId: mine?.deck.id ?? "" };
        paint();
      })();
    });

    root.querySelector("#btn-turn")?.addEventListener("click", () => {
      const duel = state.open;
      if (!duel) return;
      const last = duel.turns.at(-1);
      state.turn = {
        number: (last?.number ?? 0) + 1,
        // Turns alternate: the next one is the other player's, unless it is the
        // first — which the person writing it can change anyway.
        playerId: last
          ? (last.playerId === duel.host.player?.id ? duel.guest.player?.id : duel.host.player?.id) ?? ""
          : knownUser()?.id ?? "",
        hostLife: String(last?.hostLife ?? STARTING_LIFE),
        guestLife: String(last?.guestLife ?? STARTING_LIFE),
        note: "",
      };
      paint();
    });
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !state.busy) closeModals();
  }, { signal });

  paint();
  await (duelId ? loadDuel() : loadList());
  if (signal.aborted) return;
  paint();
}
