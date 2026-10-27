ALTER TABLE "discrello"."list_mappings" ADD COLUMN "comment_template" text;--> statement-breakpoint
ALTER TABLE "discrello"."notifications" ADD COLUMN "trello_comment_id" text;--> statement-breakpoint
ALTER TABLE "discrello"."notifications" ADD CONSTRAINT "notifications_trello_comment_id_unique" UNIQUE("trello_comment_id");