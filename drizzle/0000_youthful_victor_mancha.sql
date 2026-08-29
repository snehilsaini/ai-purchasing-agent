CREATE TABLE "purchasing_cases" (
	"id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"status" text NOT NULL,
	"priority" text NOT NULL,
	"decision" text NOT NULL,
	"proposal_version" integer,
	"revision" integer DEFAULT 1 NOT NULL,
	"aggregate" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "purchasing_cases_status_idx" ON "purchasing_cases" USING btree ("status");--> statement-breakpoint
CREATE INDEX "purchasing_cases_updated_at_idx" ON "purchasing_cases" USING btree ("updated_at");