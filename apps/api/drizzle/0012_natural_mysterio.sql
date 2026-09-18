CREATE TABLE "duel_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"duel_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"player_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"host_life" integer NOT NULL,
	"guest_life" integer NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "duel_turns_number" CHECK ("duel_turns"."number" between 1 and 999),
	CONSTRAINT "duel_turns_life_bounds" CHECK ("duel_turns"."host_life" between 0 and 99999 and "duel_turns"."guest_life" between 0 and 99999)
);
--> statement-breakpoint
CREATE TABLE "duels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" uuid NOT NULL,
	"guest_id" uuid NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"played_on" timestamp with time zone DEFAULT now() NOT NULL,
	"host_deck_id" uuid,
	"host_deck_name" text,
	"guest_deck_id" uuid,
	"guest_deck_name" text,
	"host_score" integer,
	"guest_score" integer,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_at" timestamp with time zone,
	CONSTRAINT "duels_status_vocab" CHECK ("duels"."status" in ('proposed', 'open', 'recorded')),
	CONSTRAINT "duels_two_players" CHECK ("duels"."host_id" <> "duels"."guest_id"),
	CONSTRAINT "duels_score_pair" CHECK (("duels"."host_score" is null) = ("duels"."guest_score" is null)),
	CONSTRAINT "duels_score_bounds" CHECK ("duels"."host_score" is null or ("duels"."host_score" between 0 and 99 and "duels"."guest_score" between 0 and 99)),
	CONSTRAINT "duels_recorded_has_score" CHECK (("duels"."status" = 'recorded') = ("duels"."host_score" is not null))
);
--> statement-breakpoint
ALTER TABLE "duel_turns" ADD CONSTRAINT "duel_turns_duel_id_duels_id_fk" FOREIGN KEY ("duel_id") REFERENCES "public"."duels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duel_turns" ADD CONSTRAINT "duel_turns_player_id_users_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duel_turns" ADD CONSTRAINT "duel_turns_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duels" ADD CONSTRAINT "duels_host_id_users_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duels" ADD CONSTRAINT "duels_guest_id_users_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duels" ADD CONSTRAINT "duels_host_deck_id_decks_id_fk" FOREIGN KEY ("host_deck_id") REFERENCES "public"."decks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duels" ADD CONSTRAINT "duels_guest_deck_id_decks_id_fk" FOREIGN KEY ("guest_deck_id") REFERENCES "public"."decks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "duel_turns_number_uidx" ON "duel_turns" USING btree ("duel_id","number");--> statement-breakpoint
CREATE INDEX "duels_host_idx" ON "duels" USING btree ("host_id","played_on" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "duels_guest_idx" ON "duels" USING btree ("guest_id","played_on" DESC NULLS LAST);