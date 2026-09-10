CREATE TABLE "auth_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bucket" text NOT NULL,
	"action" text NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"tag" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"locale" text DEFAULT 'fr' NOT NULL,
	"token_version" integer DEFAULT 0 NOT NULL,
	"suspended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_role_vocab" CHECK ("users"."role" in ('member', 'admin')),
	CONSTRAINT "users_locale_vocab" CHECK ("users"."locale" in ('fr', 'en'))
);
--> statement-breakpoint
CREATE TABLE "card_prints" (
	"id" serial PRIMARY KEY NOT NULL,
	"card_passcode" bigint,
	"set_code" text NOT NULL,
	"canonical_set_code" text NOT NULL,
	"set_name" text,
	"rarity" text DEFAULT '' NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"resolve_status" text DEFAULT 'pending' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_prints_status_vocab" CHECK ("card_prints"."resolve_status" in ('resolved', 'pending', 'unidentified')),
	CONSTRAINT "card_prints_resolved_has_card" CHECK (("card_prints"."resolve_status" = 'resolved') = ("card_prints"."card_passcode" is not null))
);
--> statement-breakpoint
CREATE TABLE "cards" (
	"passcode" bigint PRIMARY KEY NOT NULL,
	"name_en" text NOT NULL,
	"name_fr" text,
	"desc_en" text,
	"desc_fr" text,
	"type" text,
	"frame_type" text,
	"race" text,
	"attribute" text,
	"atk" integer,
	"def" integer,
	"level" integer,
	"scale" integer,
	"link_value" integer,
	"link_markers" jsonb,
	"archetype" text,
	"banlist_tcg" text,
	"image_url" text,
	"image_url_small" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "card_prints" ADD CONSTRAINT "card_prints_card_passcode_cards_passcode_fk" FOREIGN KEY ("card_passcode") REFERENCES "public"."cards"("passcode") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_attempts_lookup_idx" ON "auth_attempts" USING btree ("bucket","action","attempted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uidx" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_name_tag_uidx" ON "users" USING btree ("display_name","tag");--> statement-breakpoint
CREATE UNIQUE INDEX "card_prints_identity_uidx" ON "card_prints" USING btree ("set_code","rarity","language");--> statement-breakpoint
CREATE INDEX "card_prints_canonical_idx" ON "card_prints" USING btree ("canonical_set_code");--> statement-breakpoint
CREATE INDEX "card_prints_card_idx" ON "card_prints" USING btree ("card_passcode");--> statement-breakpoint
CREATE INDEX "cards_name_en_idx" ON "cards" USING btree ("name_en");--> statement-breakpoint
CREATE INDEX "cards_name_fr_idx" ON "cards" USING btree ("name_fr");--> statement-breakpoint
CREATE INDEX "cards_archetype_idx" ON "cards" USING btree ("archetype");