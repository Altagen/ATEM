/**
 * The duels screen — wiring.
 *
 * `/duels` lists what one has played or been invited to; `/duels?duel=<id>`
 * opens one. Every gesture takes the state the server answers, never what the
 * screen hoped: a duel is written by two people, and the other one may have
 * moved first.
 */
import { halvedLife } from "@atem/shared";
import { api, ApiError } from "../../platform/api.js";
import { t } from "../../platform/i18n/index.js";
import { refreshInbox } from "../../platform/navigation.js";
import { navigate } from "../../platform/router.js";
import { toast } from "../../platform/ui.js";
import type { Duellist } from "../community/state.js";
import { duelState, type DeckChoice, type Duel, type DuelDetail } from "./state.js";
import { detailHtml, listHtml } from "./view.js";

export async function duelScreen(
  root: HTMLElement,
  params: URLSearchParams,
  signal: AbortSignal,
): Promise<void> {
  const state = duelState();
  const duelId = params.get("duel");
  /**
   * Which list one is on lives in the address, not only in memory.
   *
   * The maintainer, on 2026-09-19: opening a past duel and coming back landed on the
   * current one, two clicks from where he was. The address carries it, so the
   * way back — and a reload, and the browser's own back button — all return to
   * the list that was being read.
   */
  state.showPast = params.get("past") === "1";

  const reason = (err: unknown, fallback: string): string =>
    err instanceof ApiError ? err.message : fallback;

  function paint(): void {
    root.innerHTML = (duelId ? detailHtml(state) : listHtml(state)).toString();
    bind();
  }

  async function loadList(): Promise<void> {
    try {
      const { items } = await api<{ items: Duel[] }>("/duels?past=0");
      state.duels = items;
      state.failure = null;
    } catch (err) {
      state.duels = [];
      state.failure = reason(err, t("The duels could not be loaded."));
    }
  }

  /**
   * The duels already played, a page at a time.
   *
   * They accumulate for as long as one plays, so they are asked for when their
   * list is opened and extended from there — never all at once.
   */
  async function loadPast(more = false): Promise<void> {
    const cursor = more ? state.pastCursor : null;
    try {
      const answer = await api<{ items: Duel[]; nextCursor: string | null }>(
        `/duels?past=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      state.past = more && state.past ? [...state.past, ...answer.items] : answer.items;
      state.pastCursor = answer.nextCursor;
    } catch (err) {
      if (!more) state.past = [];
      toast(reason(err, t("The duels could not be loaded.")), "error");
    }
  }

  /**
   * The duel, as the server has it.
   *
   * **A duel that is no longer there takes us back to the list.** The other
   * duellist may have called it off while this screen was open: staying on
   * “this duel could not be opened” would leave the person to work out that
   * something happened elsewhere — The maintainer, on 2026-09-19.
   */
  async function loadDuel(): Promise<void> {
    if (!duelId) return;
    try {
      state.open = await api<DuelDetail>(`/duels/${duelId}`);
      state.failure = null;
    } catch (err) {
      state.open = null;
      if (err instanceof ApiError && err.status === 404) {
        toast(t("This duel was called off."), "info");
        navigate("/duels");
        return;
      }
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
    // The coin is not a window: it closes when it has been read.
    state.invite = null;
    state.result = null;
    state.life = null;
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
      if (done) toast(done, "success");
    } catch (err) {
      toast(reason(err, t("The request failed.")), "error");
    } finally {
      state.busy = false;
      await refreshInbox();
      if (!signal.aborted) paint();
    }
  }

  /**
   * The coin: it turns, then it settles on what the server drew.
   *
   * The draw is the server's (`docs/ref-duels.md`); this is the only part that
   * belongs to the screen — showing it happen. A result that appears the instant
   * one asks for it is a result one doubts, and this one decides who starts.
   *
   * Someone who has asked for less motion is shown the answer without the
   * turning: the information is the same, the flourish is not.
   */
  const COIN_TICK_MS = 110;
  const COIN_TURNS = 12;

  /**
   * The coin, seen from the other side: it has fallen, this only shows on whom.
   *
   * No turning here — the name is already known, and pretending to draw it
   * again would be theatre over a decision already made.
   */
  async function showCoinResult(started: DuelDetail): Promise<void> {
    const names: [string, string] = [
      started.host.player?.displayName ?? t("Host"),
      started.guest.player?.displayName ?? t("Guest"),
    ];
    const first = started.currentPlayerId === started.host.player?.id
      ? started.host.player
      : started.guest.player;
    state.coin = { names, winner: first?.displayName ?? names[0] };
    paint();
    await new Promise((done) => setTimeout(done, 1_400));
    if (signal.aborted) return;
    state.coin = null;
    toast(t("{name} won the coin flip and begins.", { name: first?.displayName ?? "" }), "success");
  }

  async function flipCoin(duel: DuelDetail): Promise<void> {
    const names: [string, string] = [
      duel.host.player?.displayName ?? t("Host"),
      duel.guest.player?.displayName ?? t("Guest"),
    ];
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    state.coin = { names, winner: null };
    state.busy = true;
    paint();

    let face = 0;
    const timer = still ? null : window.setInterval(() => {
      face += 1;
      const node = root.querySelector<HTMLElement>(".duel-coin-name");
      if (node) node.textContent = names[face % 2]!;
    }, COIN_TICK_MS);

    try {
      const [started] = await Promise.all([
        api<DuelDetail>(`/duels/${duelId}/start`, { method: "POST" }),
        still ? Promise.resolve() : new Promise((done) => setTimeout(done, COIN_TICK_MS * COIN_TURNS)),
      ]);
      if (timer !== null) window.clearInterval(timer);
      if (signal.aborted) return;

      state.open = started;
      const first = started.currentPlayerId === started.host.player?.id
        ? started.host.player
        : started.guest.player;
      state.coin = { names, winner: first?.displayName ?? names[0] };
      paint();

      // Long enough to read the name, short enough not to be in the way.
      await new Promise((done) => setTimeout(done, 900));
      if (signal.aborted) return;
      state.coin = null;
      toast(t("{name} won the coin flip and begins.", { name: first?.displayName ?? "" }), "success");
    } catch (err) {
      if (timer !== null) window.clearInterval(timer);
      state.coin = null;
      toast(err instanceof ApiError ? err.message : t("The request failed."), "error");
    } finally {
      state.busy = false;
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
      const winnerId = state.result?.winnerId ?? "";
      const note = value("result-note") || null;
      if (!winnerId) return;
      void act(async () => {
        await api(`/duels/${duelId}/result`, {
          method: "POST",
          body: { winnerId, note },
        });
        state.result = null;
        await loadDuel();
      }, t("Result recorded."));
    });

    /**
     * Life points, on one's own card.
     *
     * The offered amounts act straight away: they are small, the opposite
     * button undoes one, and the history keeps what happened. Asking for a
     * confirmation on “−500” would be three taps for a figure the two players
     * are saying out loud anyway.
     */
    const declare = (delta: number, note: string | null, done: string): void => {
      void act(async () => {
        const duel = await api<DuelDetail>(`/duels/${duelId}/life`, {
          method: "POST",
          body: { delta, note },
        });
        state.open = duel;
        // Off zero, the victory panel has nothing to stand on: the duel resumes.
        if (duel.host.life > 0 && duel.guest.life > 0) state.correcting = false;
      }, done);
    };

    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-step]")) {
      const step = Number(button.dataset.step);
      button.addEventListener("click", () => declare(
        step,
        null,
        step < 0 ? t("Life points taken.") : t("Life points given back."),
      ));
    }

    root.querySelector("[data-halve]")?.addEventListener("click", () => {
      const duel = state.open;
      if (!duel) return;
      const mine = duel.isHost ? duel.host : duel.guest;
      // Halved, rounded up — `halvedLife` is the figure the server would reach.
      const after = halvedLife(mine.life);
      if (after === mine.life) return;
      declare(after - mine.life, t("Halved."), t("Life points halved."));
    });

    root.querySelector("#btn-life-other")?.addEventListener("click", () => {
      state.life = { amount: "", note: "" };
      paint();
      root.querySelector<HTMLInputElement>("#life-amount")?.focus();
    });

    const sendLife = (sign: 1 | -1): void => {
      const amount = Number(value("life-amount"));
      const note = value("life-note") || null;
      if (!Number.isInteger(amount) || amount <= 0) {
        toast(t("Life points are a whole number."), "error");
        return;
      }
      void act(async () => {
        state.open = await api<DuelDetail>(`/duels/${duelId}/life`, {
          method: "POST",
          body: { delta: sign * amount, note },
        });
        state.life = null;
      }, sign < 0 ? t("Life points taken.") : t("Life points given back."));
    };

    root.querySelector("#form-life")?.addEventListener("submit", (event) => {
      event.preventDefault();
      sendLife(-1);
    });
    root.querySelector("#btn-life-give")?.addEventListener("click", () => sendLife(1));

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

    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-duels]")) {
      button.addEventListener("click", () => {
        // The address is the state: navigating repaints the screen from it.
        navigate(button.dataset.duels === "past" ? "/duels?past=1" : "/duels");
      });
    }

    root.querySelector("#btn-more-past")?.addEventListener("click", () => {
      void loadPast(true).then(() => {
        if (!signal.aborted) paint();
      });
    });

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
      const duel = state.open;
      // Coming from a duellist at zero, the winner is already known: the one
      // still standing. It is a proposal — the window lets it be changed.
      const beaten = duel?.host.life === 0 ? duel.guest : duel?.guest.life === 0 ? duel.host : null;
      state.result = { winnerId: beaten?.player?.id ?? "", note: "" };
      paint();
    });

    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-winner]")) {
      button.addEventListener("click", () => {
        if (!state.result) return;
        state.result.winnerId = button.dataset.winner ?? "";
        paint();
      });
    }

    root.querySelector("#btn-log-order")?.addEventListener("click", () => {
      state.newestFirst = !state.newestFirst;
      paint();
    });

    root.querySelector("#btn-focus")?.addEventListener("click", () => {
      state.focus = !state.focus;
      paint();
      window.scrollTo({ top: 0 });
    });

    /**
     * Ending the duel from the board.
     *
     * A duel stops when the players stop, and after correcting a life total
     * back off zero there was otherwise no way back to the result but to take
     * the points down again.
     */
    root.querySelector("#btn-finish")?.addEventListener("click", () => {
      const duel = state.open;
      const beaten = duel?.host.life === 0 ? duel.guest : duel?.guest.life === 0 ? duel.host : null;
      state.correcting = false;
      state.result = { winnerId: beaten?.player?.id ?? "", note: "" };
      paint();
    });

    root.querySelector("#btn-correct")?.addEventListener("click", () => {
      // Back to the board: a life total reaches zero by a mistyped figure as
      // easily as by an attack.
      state.correcting = true;
      paint();
    });

    root.querySelector("#btn-start")?.addEventListener("click", () => {
      const duel = state.open;
      if (!duel || state.busy) return;
      void flipCoin(duel);
    });

    root.querySelector("#btn-phase")?.addEventListener("click", () => {
      void act(async () => {
        state.open = await api<DuelDetail>(`/duels/${duelId}/phase`, { method: "POST" });
      }, t("Next phase."));
    });

    root.querySelector("#btn-end-turn")?.addEventListener("click", () => {
      void act(async () => {
        state.open = await api<DuelDetail>(`/duels/${duelId}/turn`, { method: "POST" });
      }, t("The turn passes."));
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

  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !state.busy) closeModals();
  }, { signal });

  paint();
  // The past list is read when it is the one being shown, so a duel just
  // recorded is in it.
  await (duelId ? loadDuel() : state.showPast ? loadPast() : loadList());
  if (signal.aborted) return;
  paint();

  /**
   * A duel is followed from two devices, so this one asks what the other did.
   *
   * Every five seconds, and **only when there is nothing under way here**: a
   * repaint while a window is open would rebuild its fields and lose what is
   * being typed — the defect measured on the turn window on 2026-09-18. A
   * hidden tab asks for nothing, and a finished duel has nothing left to learn.
   */
  if (duelId) {
    /**
     * Waiting for the other to start is the one moment a few seconds are long.
     *
     * The maintainer, on 2026-09-19: the duellist who did not flip the coin waited
     * without a sign. So the beat is quicker while the duel has not begun, and
     * when the poll finds that it has, **this screen shows the coin too** — it
     * settles straight on the name, because it has already been drawn.
     */
    const beat = () => (state.open?.status === "playing" ? 5_000 : 2_000);
    let timer = 0;

    const tick = async (): Promise<void> => {
      if (!document.hidden && !state.busy
        && !state.invite && !state.result && !state.life && !state.deckPick
        && state.open?.status !== "recorded") {
        const was = state.open?.status;
        await loadDuel();
        if (signal.aborted) return;

        if (was === "accepted" && state.open?.status === "playing") {
          await showCoinResult(state.open);
          if (signal.aborted) return;
        }
        if (!state.busy) paint();
      }
      timer = window.setTimeout(() => void tick(), beat());
    };

    timer = window.setTimeout(() => void tick(), beat());
    signal.addEventListener("abort", () => window.clearTimeout(timer));
  }
}
