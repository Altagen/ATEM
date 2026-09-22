ALTER TABLE "duel_events" DROP CONSTRAINT "duel_events_author_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "duels" DROP CONSTRAINT "duels_host_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "duels" DROP CONSTRAINT "duels_guest_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "duel_events" ALTER COLUMN "author_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "duels" ALTER COLUMN "host_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "duels" ALTER COLUMN "guest_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "duel_events" ADD CONSTRAINT "duel_events_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duels" ADD CONSTRAINT "duels_host_id_users_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duels" ADD CONSTRAINT "duels_guest_id_users_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;