CREATE TABLE "scanlist_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"scanlist_id" uuid NOT NULL,
	"set_code" text NOT NULL,
	"name" text,
	"passcode" integer,
	"quantity" integer NOT NULL,
	CONSTRAINT "scanlist_lines_quantity_ck" CHECK ("scanlist_lines"."quantity" between 1 and 1000)
);
--> statement-breakpoint
CREATE TABLE "scanlists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"poured_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "scanlist_lines" ADD CONSTRAINT "scanlist_lines_scanlist_id_scanlists_id_fk" FOREIGN KEY ("scanlist_id") REFERENCES "public"."scanlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scanlists" ADD CONSTRAINT "scanlists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scanlist_lines_list_code_uidx" ON "scanlist_lines" USING btree ("scanlist_id","set_code");--> statement-breakpoint
CREATE INDEX "scanlists_user_idx" ON "scanlists" USING btree ("user_id","created_at");