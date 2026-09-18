/**
 * The turn of a duel, as the game plays it.
 *
 * Six phases in this order, and only **one** Standby Phase — at the start of the
 * turn, not before the End Phase. The Battle Phase has steps of its own (start,
 * battle, damage, end); ATEM does not follow them: it is the notebook beside the
 * mat, and nobody announces a damage step out loud.
 *
 * Shared so that the server and the screen cannot disagree about what follows
 * what — the kind of thing that drifts the day one of the two is edited alone.
 */
export const DUEL_PHASES = ["draw", "standby", "main1", "battle", "main2", "end"] as const;

export type DuelPhase = (typeof DUEL_PHASES)[number];

/** What follows this phase, or `null` at the end of the turn. */
export function nextPhase(phase: DuelPhase): DuelPhase | null {
  const index = DUEL_PHASES.indexOf(phase);
  return DUEL_PHASES[index + 1] ?? null;
}

/** Life points both duellists start on. */
export const STARTING_LIFE = 8000;

/** The bounds a life total is kept within — not the rules of any format. */
export const LIFE_BOUNDS = { min: 0, max: 99_999 } as const;
