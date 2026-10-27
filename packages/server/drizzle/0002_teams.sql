CREATE TABLE "discrello"."team_members" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "discrello"."team_members_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"team_id" bigint NOT NULL,
	"role_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discrello"."teams" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "discrello"."teams_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "discrello"."list_mappings" ALTER COLUMN "role_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "discrello"."list_mappings" ADD COLUMN "team_id" bigint;--> statement-breakpoint
ALTER TABLE "discrello"."notifications" ADD COLUMN "team_id" bigint;--> statement-breakpoint
ALTER TABLE "discrello"."notifications" ADD COLUMN "mentions_json" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "discrello"."team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "discrello"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discrello"."team_members" ADD CONSTRAINT "team_members_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "discrello"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "team_members_team_role_uq" ON "discrello"."team_members" USING btree ("team_id","role_id");--> statement-breakpoint
CREATE INDEX "team_members_role_idx" ON "discrello"."team_members" USING btree ("role_id");--> statement-breakpoint
ALTER TABLE "discrello"."list_mappings" ADD CONSTRAINT "list_mappings_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "discrello"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discrello"."notifications" ADD CONSTRAINT "notifications_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "discrello"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "list_mappings_team_idx" ON "discrello"."list_mappings" USING btree ("team_id");--> statement-breakpoint
ALTER TABLE "discrello"."list_mappings" ADD CONSTRAINT "list_mappings_role_xor_team" CHECK (("role_id" IS NULL) <> ("team_id" IS NULL));--> statement-breakpoint
UPDATE "discrello"."notifications" SET "mentions_json" = jsonb_build_array(jsonb_build_object('kind', "mention_kind"::text, 'id', "mention_id")) WHERE "mention_kind" IS NOT NULL AND "mention_id" IS NOT NULL;
