ALTER TABLE "duels" DROP CONSTRAINT "duels_recorded_has_score";--> statement-breakpoint
ALTER TABLE "duels" DROP COLUMN "host_score";--> statement-breakpoint
ALTER TABLE "duels" DROP COLUMN "guest_score";