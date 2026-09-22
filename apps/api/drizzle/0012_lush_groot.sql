CREATE TABLE "duel_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"duel_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"kind" text NOT NULL,
	"turn_number" integer NOT NULL,
	"phase" text NOT NULL,
	"author_id" uuid NOT NULL,
	"player_id" uuid,
	"delta" integer,
	"host_life" integer NOT NULL,
	"guest_life" integer NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "duel_events_kind_vocab" CHECK ("duel_events"."kind" in ('start', 'phase', 'turn', 'life')),
	CONSTRAINT "duel_events_phase_vocab" CHECK ("duel_events"."phase" in ('draw', 'standby', 'main1', 'battle', 'main2', 'end')),
	CONSTRAINT "duel_events_life_has_delta" CHECK (("duel_events"."kind" = 'life') = ("duel_events"."delta" is not null))
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
	"turn_number" integer,
	"phase" text,
	"current_player_id" uuid,
	"host_life" integer DEFAULT 8000 NOT NULL,
	"guest_life" integer DEFAULT 8000 NOT NULL,
	"started_at" timestamp with time zone,
	"host_score" integer,
	"guest_score" integer,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_at" timestamp with time zone,
	CONSTRAINT "duels_status_vocab" CHECK ("duels"."status" in ('proposed', 'accepted', 'playing', 'recorded')),
	CONSTRAINT "duels_two_players" CHECK ("duels"."host_id" <> "duels"."guest_id"),
	CONSTRAINT "duels_phase_vocab" CHECK ("duels"."phase" is null or "duels"."phase" in ('draw', 'standby', 'main1', 'battle', 'main2', 'end')),
	CONSTRAINT "duels_turn_number" CHECK ("duels"."turn_number" is null or "duels"."turn_number" between 1 and 999),
	CONSTRAINT "duels_life_bounds" CHECK ("duels"."host_life" between 0 and 99999
        and "duels"."guest_life" between 0 and 99999),
	CONSTRAINT "duels_score_pair" CHECK (("duels"."host_score" is null) = ("duels"."guest_score" is null)),
	CONSTRAINT "duels_score_bounds" CHECK ("duels"."host_score" is null or ("duels"."host_score" between 0 and 99 and "duels"."guest_score" between 0 and 99)),
	CONSTRAINT "duels_recorded_has_score" CHECK (("duels"."status" = 'recorded') = ("duels"."host_score" is not null)),
	CONSTRAINT "duels_playing_has_place" CHECK (("duels"."status" = 'playing') = ("duels"."turn_number" is not null and "duels"."phase" is not null))
);
--> statement-breakpoint
ALTER TABLE "duel_events" ADD CONSTRAINT "duel_events_duel_id_duels_id_fk" FOREIGN KEY ("duel_id") REFERENCES "public"."duels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duel_events" ADD CONSTRAINT "duel_events_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duel_events" ADD CONSTRAINT "duel_events_player_id_users_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duels" ADD CONSTRAINT "duels_host_id_users_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duels" ADD CONSTRAINT "duels_guest_id_users_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duels" ADD CONSTRAINT "duels_host_deck_id_decks_id_fk" FOREIGN KEY ("host_deck_id") REFERENCES "public"."decks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duels" ADD CONSTRAINT "duels_guest_deck_id_decks_id_fk" FOREIGN KEY ("guest_deck_id") REFERENCES "public"."decks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duels" ADD CONSTRAINT "duels_current_player_id_users_id_fk" FOREIGN KEY ("current_player_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "duel_events_seq_uidx" ON "duel_events" USING btree ("duel_id","seq");--> statement-breakpoint
CREATE INDEX "duels_host_idx" ON "duels" USING btree ("host_id","played_on" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "duels_guest_idx" ON "duels" USING btree ("guest_id","played_on" DESC NULLS LAST);