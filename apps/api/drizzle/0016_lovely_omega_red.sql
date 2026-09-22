ALTER TABLE "users" ADD COLUMN "collection_visibility" text DEFAULT 'friends' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deck_visibility" text DEFAULT 'friends' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_collection_visibility_vocab" CHECK ("users"."collection_visibility" in ('everyone', 'friends', 'private'));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_deck_visibility_vocab" CHECK ("users"."deck_visibility" in ('everyone', 'friends', 'private'));