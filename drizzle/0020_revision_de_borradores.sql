ALTER TABLE "message_triage" ADD COLUMN "decision" text;--> statement-breakpoint
ALTER TABLE "message_triage" ADD COLUMN "review_action" text;--> statement-breakpoint
ALTER TABLE "message_triage" ADD COLUMN "reviewed_by" uuid;--> statement-breakpoint
ALTER TABLE "message_triage" ADD COLUMN "reviewed_at" timestamp with time zone;