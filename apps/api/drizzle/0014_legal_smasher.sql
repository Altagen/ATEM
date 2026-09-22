ALTER TABLE "duels" DROP CONSTRAINT "duels_score_pair";--> statement-breakpoint
ALTER TABLE "duels" DROP CONSTRAINT "duels_score_bounds";--> statement-breakpoint
ALTER TABLE "duels" ADD COLUMN "winner_id" uuid;--> statement-breakpoint
ALTER TABLE "duels" ADD CONSTRAINT "duels_winner_id_users_id_fk" FOREIGN KEY ("winner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duels" ADD CONSTRAINT "duels_winner_played" CHECK ("duels"."winner_id" is null or "duels"."winner_id" in ("duels"."host_id", "duels"."guest_id"));--> statement-breakpoint
/*
 * The duels already recorded kept a score; they keep a winner now.
 *
 * The higher score won. A draw cannot be carried over — a duel has a winner
 * and a loser from here on — so the few that exist are attributed to the host:
 * there is no honest way to rewrite them, and losing them would be worse.
 */
UPDATE "duels" SET "winner_id" = CASE
  WHEN "guest_score" > "host_score" THEN "guest_id"
  ELSE "host_id"
END WHERE "status" = 'recorded';--> statement-breakpoint
ALTER TABLE "duels" ADD CONSTRAINT "duels_recorded_has_winner" CHECK (("duels"."status" = 'recorded') = ("duels"."winner_id" is not null));