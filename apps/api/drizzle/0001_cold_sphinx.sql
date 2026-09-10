CREATE TABLE "owned_cards" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"print_id" integer NOT NULL,
	"set_code" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"is_favorite" boolean DEFAULT false NOT NULL,
	"notes" text,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "owned_cards" ADD CONSTRAINT "owned_cards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owned_cards" ADD CONSTRAINT "owned_cards_print_id_card_prints_id_fk" FOREIGN KEY ("print_id") REFERENCES "public"."card_prints"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "owned_cards_user_print_uidx" ON "owned_cards" USING btree ("user_id","print_id");--> statement-breakpoint
CREATE INDEX "owned_cards_user_idx" ON "owned_cards" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "owned_cards_user_favorite_idx" ON "owned_cards" USING btree ("user_id","is_favorite");--> statement-breakpoint
CREATE INDEX "owned_cards_set_code_idx" ON "owned_cards" USING btree ("set_code");