CREATE TABLE "deck_cards" (
	"deck_id" uuid NOT NULL,
	"passcode" bigint NOT NULL,
	"main_qty" integer DEFAULT 0 NOT NULL,
	"extra_qty" integer DEFAULT 0 NOT NULL,
	"side_qty" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "deck_cards_max_copies_ck" CHECK ("deck_cards"."main_qty" + "deck_cards"."extra_qty" + "deck_cards"."side_qty" between 0 and 3),
	CONSTRAINT "deck_cards_non_negative_ck" CHECK ("deck_cards"."main_qty" >= 0 and "deck_cards"."extra_qty" >= 0 and "deck_cards"."side_qty" >= 0)
);
--> statement-breakpoint
CREATE TABLE "decks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deck_cards" ADD CONSTRAINT "deck_cards_deck_id_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."decks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_cards" ADD CONSTRAINT "deck_cards_passcode_cards_passcode_fk" FOREIGN KEY ("passcode") REFERENCES "public"."cards"("passcode") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decks" ADD CONSTRAINT "decks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deck_cards_identity_uidx" ON "deck_cards" USING btree ("deck_id","passcode");--> statement-breakpoint
CREATE INDEX "deck_cards_passcode_idx" ON "deck_cards" USING btree ("passcode");--> statement-breakpoint
CREATE INDEX "decks_user_idx" ON "decks" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "decks_user_name_uidx" ON "decks" USING btree ("user_id","name");