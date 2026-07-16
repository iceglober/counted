DROP INDEX IF EXISTS "dashboards_project_slug";--> statement-breakpoint
ALTER TABLE "dashboards" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "dashboards" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dashboards_user_idx" ON "dashboards" USING btree ("user_id");--> statement-breakpoint
UPDATE "dashboards" d SET "user_id" = (
  SELECT pm."user_id" FROM "project_members" pm
  WHERE pm."project_id" = d."project_id"
  ORDER BY (pm."role" = 'owner') DESC
  LIMIT 1
) WHERE d."user_id" IS NULL AND d."project_id" IS NOT NULL;
