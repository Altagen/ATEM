ALTER TABLE "users" ADD COLUMN "bio" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar" text DEFAULT 'dragon' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_avatar_vocab" CHECK ("users"."avatar" in ('dragon', 'spellcaster', 'warrior', 'harpie', 'occult'));