CREATE TABLE "blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"blocked_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blocks_not_self" CHECK ("blocks"."user_id" <> "blocks"."blocked_user_id")
);
--> statement-breakpoint
CREATE TABLE "friend_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_a" uuid NOT NULL,
	"user_b" uuid NOT NULL,
	"requester_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	CONSTRAINT "friend_edges_ordered" CHECK ("friend_edges"."user_a" < "friend_edges"."user_b"),
	CONSTRAINT "friend_edges_requester" CHECK ("friend_edges"."requester_id" in ("friend_edges"."user_a", "friend_edges"."user_b")),
	CONSTRAINT "friend_edges_status" CHECK ("friend_edges"."status" in ('pending', 'accepted'))
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocked_user_id_users_id_fk" FOREIGN KEY ("blocked_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friend_edges" ADD CONSTRAINT "friend_edges_user_a_users_id_fk" FOREIGN KEY ("user_a") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friend_edges" ADD CONSTRAINT "friend_edges_user_b_users_id_fk" FOREIGN KEY ("user_b") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friend_edges" ADD CONSTRAINT "friend_edges_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "blocks_pair_uidx" ON "blocks" USING btree ("user_id","blocked_user_id");--> statement-breakpoint
CREATE INDEX "blocks_blocked_idx" ON "blocks" USING btree ("blocked_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "friend_edges_pair_uidx" ON "friend_edges" USING btree ("user_a","user_b");--> statement-breakpoint
CREATE INDEX "friend_edges_user_b_idx" ON "friend_edges" USING btree ("user_b");