CREATE SCHEMA "discrello";
--> statement-breakpoint
CREATE TYPE "discrello"."bot_status" AS ENUM('ok', 'not_in_guild', 'missing_permissions', 'unchecked');--> statement-breakpoint
CREATE TYPE "discrello"."check_status" AS ENUM('ok', 'error', 'unchecked');--> statement-breakpoint
CREATE TYPE "discrello"."mention_kind" AS ENUM('user', 'role');--> statement-breakpoint
CREATE TYPE "discrello"."notification_status" AS ENUM('pending', 'sending', 'sent', 'sent_no_mention', 'failed');--> statement-breakpoint
CREATE TYPE "discrello"."webhook_event_outcome" AS ENUM('enqueued', 'ignored');--> statement-breakpoint
CREATE TYPE "discrello"."webhook_status" AS ENUM('unregistered', 'active', 'inactive', 'missing', 'mismatch', 'error');--> statement-breakpoint
CREATE TABLE "discrello"."boards" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "discrello"."boards_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"trello_board_id" text NOT NULL,
	"trello_short_link" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"closed" boolean DEFAULT false NOT NULL,
	"guild_id" bigint NOT NULL,
	"discord_channel_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"webhook_token" text NOT NULL,
	"webhook_id" text,
	"webhook_callback_url" text,
	"webhook_status" "discrello"."webhook_status" DEFAULT 'unregistered' NOT NULL,
	"webhook_consecutive_failures" integer DEFAULT 0 NOT NULL,
	"webhook_last_checked_at" timestamp with time zone,
	"webhook_last_error" text,
	"last_event_at" timestamp with time zone,
	"lists_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "boards_trello_board_id_unique" UNIQUE("trello_board_id"),
	CONSTRAINT "boards_webhook_token_unique" UNIQUE("webhook_token")
);
--> statement-breakpoint
CREATE TABLE "discrello"."guilds" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "discrello"."guilds_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"discord_guild_id" text NOT NULL,
	"name" text NOT NULL,
	"alert_channel_id" text,
	"bot_status" "discrello"."bot_status" DEFAULT 'unchecked' NOT NULL,
	"bot_check_error" text,
	"bot_checked_at" timestamp with time zone,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guilds_discord_guild_id_unique" UNIQUE("discord_guild_id")
);
--> statement-breakpoint
CREATE TABLE "discrello"."list_mappings" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "discrello"."list_mappings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"board_id" bigint NOT NULL,
	"trello_list_id" text NOT NULL,
	"role_id" bigint NOT NULL,
	"message_template" text NOT NULL,
	"override_mention_kind" "discrello"."mention_kind",
	"override_mention_id" text,
	"override_channel_id" text,
	"check_status" "discrello"."check_status" DEFAULT 'unchecked' NOT NULL,
	"check_error" text,
	"checked_at" timestamp with time zone,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discrello"."notifications" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "discrello"."notifications_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"trello_action_id" text NOT NULL,
	"board_id" bigint NOT NULL,
	"guild_id" bigint NOT NULL,
	"list_mapping_id" bigint,
	"role_id" bigint,
	"trigger_type" text NOT NULL,
	"card_id" text NOT NULL,
	"card_name" text NOT NULL,
	"card_short_link" text NOT NULL,
	"card_url" text NOT NULL,
	"list_id" text NOT NULL,
	"list_name" text NOT NULL,
	"previous_list_name" text,
	"board_name" text NOT NULL,
	"actor_name" text,
	"discord_channel_id" text,
	"mention_kind" "discrello"."mention_kind",
	"mention_id" text,
	"content" text,
	"allowed_mentions_json" jsonb,
	"status" "discrello"."notification_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"last_error" text,
	"discord_message_id" text,
	"mention_verified" boolean,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_trello_action_id_unique" UNIQUE("trello_action_id")
);
--> statement-breakpoint
CREATE TABLE "discrello"."role_targets" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "discrello"."role_targets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"role_id" bigint NOT NULL,
	"guild_id" bigint NOT NULL,
	"mention_kind" "discrello"."mention_kind" NOT NULL,
	"mention_id" text NOT NULL,
	"check_status" "discrello"."check_status" DEFAULT 'unchecked' NOT NULL,
	"check_error" text,
	"checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discrello"."roles" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "discrello"."roles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"key" text NOT NULL,
	"display_name" text NOT NULL,
	"default_template" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "discrello"."settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discrello"."trello_lists" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "discrello"."trello_lists_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"board_id" bigint NOT NULL,
	"trello_list_id" text NOT NULL,
	"name" text NOT NULL,
	"pos" double precision DEFAULT 0 NOT NULL,
	"closed" boolean DEFAULT false NOT NULL,
	"missing" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trello_lists_trello_list_id_unique" UNIQUE("trello_list_id")
);
--> statement-breakpoint
CREATE TABLE "discrello"."webhook_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "discrello"."webhook_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"trello_action_id" text NOT NULL,
	"board_id" bigint,
	"action_type" text NOT NULL,
	"card_id" text,
	"card_name" text,
	"list_id" text,
	"list_name" text,
	"outcome" "discrello"."webhook_event_outcome" NOT NULL,
	"ignore_reason" text,
	"duplicate_count" integer DEFAULT 0 NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_events_trello_action_id_unique" UNIQUE("trello_action_id")
);
--> statement-breakpoint
ALTER TABLE "discrello"."boards" ADD CONSTRAINT "boards_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "discrello"."guilds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discrello"."list_mappings" ADD CONSTRAINT "list_mappings_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "discrello"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discrello"."list_mappings" ADD CONSTRAINT "list_mappings_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "discrello"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discrello"."notifications" ADD CONSTRAINT "notifications_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "discrello"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discrello"."notifications" ADD CONSTRAINT "notifications_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "discrello"."guilds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discrello"."notifications" ADD CONSTRAINT "notifications_list_mapping_id_list_mappings_id_fk" FOREIGN KEY ("list_mapping_id") REFERENCES "discrello"."list_mappings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discrello"."notifications" ADD CONSTRAINT "notifications_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "discrello"."roles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discrello"."role_targets" ADD CONSTRAINT "role_targets_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "discrello"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discrello"."role_targets" ADD CONSTRAINT "role_targets_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "discrello"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discrello"."trello_lists" ADD CONSTRAINT "trello_lists_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "discrello"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discrello"."webhook_events" ADD CONSTRAINT "webhook_events_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "discrello"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "list_mappings_board_list_uq" ON "discrello"."list_mappings" USING btree ("board_id","trello_list_id");--> statement-breakpoint
CREATE INDEX "notifications_status_next_idx" ON "discrello"."notifications" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "notifications_guild_created_idx" ON "discrello"."notifications" USING btree ("guild_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_board_created_idx" ON "discrello"."notifications" USING btree ("board_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "role_targets_role_guild_uq" ON "discrello"."role_targets" USING btree ("role_id","guild_id");--> statement-breakpoint
CREATE INDEX "trello_lists_board_idx" ON "discrello"."trello_lists" USING btree ("board_id");--> statement-breakpoint
CREATE INDEX "webhook_events_board_received_idx" ON "discrello"."webhook_events" USING btree ("board_id","received_at");