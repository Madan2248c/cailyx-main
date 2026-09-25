-- CreateEnum
CREATE TYPE "SocialActivityStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETE', 'FAILED');

-- CreateEnum
CREATE TYPE "SocialActivityTrigger" AS ENUM ('MANUAL', 'SCHEDULED');

-- CreateEnum
CREATE TYPE "SocialActivityCadence" AS ENUM ('WEEKLY', 'MONTHLY', 'MANUAL_ONLY');

-- CreateTable
CREATE TABLE "social_activity_runs" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "status" "SocialActivityStatus" NOT NULL DEFAULT 'QUEUED',
    "triggered_by" "SocialActivityTrigger" NOT NULL,
    "previous_run_id" UUID,
    "platforms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "posts_per_platform" INTEGER NOT NULL DEFAULT 20,
    "window_days" INTEGER NOT NULL DEFAULT 30,
    "include_probable" BOOLEAN NOT NULL DEFAULT false,
    "total_cost_usd" DOUBLE PRECISION,
    "result" JSONB NOT NULL DEFAULT '{}',
    "findings" JSONB NOT NULL DEFAULT '[]',
    "deltas" JSONB NOT NULL DEFAULT '[]',
    "narrative" TEXT,
    "narrative_model" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_activity_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_posts" (
    "id" UUID NOT NULL,
    "social_activity_run_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "platform" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "posted_at" TIMESTAMP(3),
    "url" TEXT,
    "caption" TEXT,
    "like_count" INTEGER,
    "comment_count" INTEGER,
    "share_count" INTEGER,
    "view_count" INTEGER,
    "follower_count" INTEGER,
    "following_count" INTEGER,
    "post_count" INTEGER,
    "actor_id" TEXT NOT NULL,
    "raw" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_activity_schedules" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "cadence" "SocialActivityCadence" NOT NULL DEFAULT 'MANUAL_ONLY',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "platforms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "window_days" INTEGER,
    "posts_per_platform" INTEGER,
    "spend_opt_in" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_activity_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "social_activity_runs_project_id_idx" ON "social_activity_runs"("project_id");

-- CreateIndex
CREATE INDEX "social_activity_runs_previous_run_id_idx" ON "social_activity_runs"("previous_run_id");

-- CreateIndex
CREATE INDEX "social_posts_social_activity_run_id_idx" ON "social_posts"("social_activity_run_id");

-- CreateIndex
CREATE INDEX "social_posts_project_id_idx" ON "social_posts"("project_id");

-- CreateIndex
CREATE INDEX "social_posts_platform_idx" ON "social_posts"("platform");

-- CreateIndex
CREATE UNIQUE INDEX "social_activity_schedules_project_id_key" ON "social_activity_schedules"("project_id");

-- AddForeignKey
ALTER TABLE "social_activity_runs" ADD CONSTRAINT "social_activity_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_activity_runs" ADD CONSTRAINT "social_activity_runs_previous_run_id_fkey" FOREIGN KEY ("previous_run_id") REFERENCES "social_activity_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_social_activity_run_id_fkey" FOREIGN KEY ("social_activity_run_id") REFERENCES "social_activity_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_activity_schedules" ADD CONSTRAINT "social_activity_schedules_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
