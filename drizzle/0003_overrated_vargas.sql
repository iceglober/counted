-- Self-heal any pre-existing duplicate defaults so the unique index can be built
-- on existing data: keep the most recently updated default per user, demote the
-- rest. Idempotent — a no-op once there is at most one default per user.
UPDATE "dashboards" SET "is_default" = false
WHERE "is_default" AND "user_id" IS NOT NULL
  AND "id" NOT IN (
    SELECT DISTINCT ON ("user_id") "id"
    FROM "dashboards"
    WHERE "is_default" AND "user_id" IS NOT NULL
    ORDER BY "user_id", "updated_at" DESC
  );
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dashboards_one_default_per_user" ON "dashboards" USING btree ("user_id") WHERE "dashboards"."is_default";
