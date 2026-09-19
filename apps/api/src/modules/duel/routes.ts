/**
 * The duel routes.
 *
 * Every write takes the session's identity; the path carries the duel, never
 * whose it is (ADR-009). A duel that is not the caller's answers “not found”.
 */
import { Hono } from "hono";
import { z } from "zod";
import { LIMITS } from "@atem/shared";
import type { Database } from "../../db/client.js";
import { invalidInput } from "../../platform/errors.js";
import { requireViewer } from "../identity/index.js";
import {
  acceptDuel, advancePhase, changeLife, dropDuel, endTurn, getDuel, listDuels, proposeDuel,
  recordDuel, setDuelDeck, startDuel,
} from "./service.js";

const ProposeBody = z.object({
  guestId: z.string(),
  /** The day it is played: today when it is not said. */
  playedOn: z.string().datetime().optional(),
  deckId: z.string().nullable().optional(),
});

const RecordBody = z.object({
  /** Who won: a duel has a winner and a loser, not a score. */
  winnerId: z.string(),
  note: z.string().max(LIMITS.note.max).nullable().optional(),
});

const DeckBody = z.object({ deckId: z.string().nullable() });

const LifeBody = z.object({
  /**
   * Whose points — one's own, and only one's own. Optional because that is the
   * only value it can hold; a screen that sends it wrong is refused rather than
   * silently corrected.
   */
  playerId: z.string().optional(),
  /** Negative takes life points, positive gives them back. Never zero. */
  delta: z.number().int().min(-99_999).max(99_999),
  note: z.string().max(280).nullable().optional(),
});

export function duelRoutes(db: Database) {
  const app = new Hono();
  app.use("*", requireViewer);

  const viewerId = (c: { get: (key: "viewer") => { id: string } | null }): string => {
    const viewer = c.get("viewer");
    if (!viewer) throw invalidInput("No session.");
    return viewer.id;
  };

  async function body<T>(c: { req: { json: () => Promise<unknown> } }, schema: z.ZodType<T>): Promise<T> {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw invalidInput("Unreadable request body.");
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) throw invalidInput("Invalid data.", { issues: parsed.error.issues });
    return parsed.data;
  }

  /**
   * `?past=1` for the duels already played, paged; anything else for the one
   * under way. The two are read at different moments and in different numbers.
   */
  app.get("/", async (c) => {
    const past = c.req.query("past");
    if (past !== undefined && past !== "1" && past !== "0") throw invalidInput("Invalid data.");
    const cursor = c.req.query("cursor");
    if (cursor !== undefined && cursor.length > 128) throw invalidInput("Invalid data.");
    const asked = c.req.query("limit");
    const limit = asked === undefined ? undefined : Number(asked);
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 100)) {
      throw invalidInput("Invalid data.");
    }
    return c.json(await listDuels(db, viewerId(c), {
      past: past === undefined ? undefined : past === "1",
      cursor,
      limit,
    }));
  });

  app.get("/:id", async (c) => c.json(await getDuel(db, viewerId(c), c.req.param("id"))));

  app.post("/", async (c) => {
    const input = await body(c, ProposeBody);
    return c.json(
      await proposeDuel(db, viewerId(c), {
        guestId: input.guestId,
        playedOn: input.playedOn ? new Date(input.playedOn) : undefined,
        deckId: input.deckId ?? null,
      }),
      201,
    );
  });

  app.post("/:id/accept", async (c) =>
    c.json(await acceptDuel(db, viewerId(c), c.req.param("id"))));

  /** Declining an invitation and calling off an open duel: one gesture. */
  app.delete("/:id", async (c) => {
    await dropDuel(db, viewerId(c), c.req.param("id"));
    return c.json({ ok: true });
  });

  app.post("/:id/result", async (c) =>
    c.json(await recordDuel(db, viewerId(c), c.req.param("id"), await body(c, RecordBody))));

  app.put("/:id/deck", async (c) =>
    c.json(await setDuelDeck(db, viewerId(c), c.req.param("id"), (await body(c, DeckBody)).deckId)));

  /** The coin is flipped on the server: see `docs/ref-duels.md`. */
  app.post("/:id/start", async (c) =>
    c.json(await startDuel(db, viewerId(c), c.req.param("id"))));

  app.post("/:id/phase", async (c) =>
    c.json(await advancePhase(db, viewerId(c), c.req.param("id"))));

  app.post("/:id/turn", async (c) =>
    c.json(await endTurn(db, viewerId(c), c.req.param("id"))));

  app.post("/:id/life", async (c) =>
    c.json(await changeLife(db, viewerId(c), c.req.param("id"), await body(c, LifeBody))));

  return app;
}
