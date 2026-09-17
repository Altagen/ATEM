CREATE TABLE "collection_imports" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"mode" text NOT NULL,
	"imported" integer NOT NULL,
	"removed" integer NOT NULL,
	"failed" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collection_imports_mode_vocab" CHECK ("collection_imports"."mode" in ('merge', 'replace'))
);
--> statement-breakpoint
ALTER TABLE "collection_imports" ADD CONSTRAINT "collection_imports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collection_imports_user_idx" ON "collection_imports" USING btree ("user_id","created_at");