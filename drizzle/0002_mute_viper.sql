ALTER TABLE "projects" ADD COLUMN "claim_token" text;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_claim_token_unique" UNIQUE("claim_token");