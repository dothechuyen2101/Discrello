CREATE TABLE "discrello"."team_channels" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "discrello"."team_channels_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_channels_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "discrello"."list_mappings" ADD COLUMN "feedback_role_id" bigint;--> statement-breakpoint
ALTER TABLE "discrello"."list_mappings" ADD COLUMN "feedback_team_id" bigint;--> statement-breakpoint
ALTER TABLE "discrello"."teams" ADD COLUMN "channel_id" bigint;--> statement-breakpoint
ALTER TABLE "discrello"."list_mappings" ADD CONSTRAINT "list_mappings_feedback_role_id_roles_id_fk" FOREIGN KEY ("feedback_role_id") REFERENCES "discrello"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discrello"."list_mappings" ADD CONSTRAINT "list_mappings_feedback_team_id_teams_id_fk" FOREIGN KEY ("feedback_team_id") REFERENCES "discrello"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discrello"."teams" ADD CONSTRAINT "teams_channel_id_team_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "discrello"."team_channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discrello"."list_mappings" ADD CONSTRAINT "list_mappings_feedback_one_recipient" CHECK ("feedback_role_id" IS NULL OR "feedback_team_id" IS NULL);