ALTER TABLE "conversations" ADD COLUMN "agent_typing_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "human_typing_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "human_typing_user_id" uuid;