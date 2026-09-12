CREATE TABLE "deck_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deck_folders_sibling_name_uidx" UNIQUE NULLS NOT DISTINCT("user_id","parent_id","name")
);
--> statement-breakpoint
ALTER TABLE "decks" ADD COLUMN "folder_id" uuid;--> statement-breakpoint
ALTER TABLE "deck_folders" ADD CONSTRAINT "deck_folders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_folders" ADD CONSTRAINT "deck_folders_parent_id_deck_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."deck_folders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deck_folders_user_idx" ON "deck_folders" USING btree ("user_id","parent_id");--> statement-breakpoint
ALTER TABLE "decks" ADD CONSTRAINT "decks_folder_id_deck_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."deck_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "decks_user_folder_idx" ON "decks" USING btree ("user_id","folder_id");