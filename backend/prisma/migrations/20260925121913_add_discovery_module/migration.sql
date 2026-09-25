-- CreateEnum
CREATE TYPE "DiscoveryRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'PAUSED', 'COMPLETE', 'COMPLETE_WITH_GAPS', 'MANUAL_REVIEW_REQUIRED', 'FAILED');

-- CreateEnum
CREATE TYPE "DiscoveryStage" AS ENUM ('DISCOVER', 'INSPECT', 'SELECT', 'EXTRACT', 'RECONCILE', 'VALIDATE', 'SOCIAL_DISCOVERY', 'EXTERNAL_ENRICH', 'CONSOLIDATE', 'GAP_RESEARCH', 'VERIFY');

-- CreateEnum
CREATE TYPE "PageType" AS ENUM ('HOMEPAGE', 'SERVICE', 'PRICING', 'ABOUT', 'INDUSTRIES', 'LOCATION', 'CASE_STUDY', 'LEADERSHIP', 'SECURITY', 'PRESS', 'CAREERS', 'PARTNER', 'BLOG', 'OTHER', 'CART', 'LOGIN', 'POLICY');

-- CreateEnum
CREATE TYPE "PageFetchStatus" AS ENUM ('PENDING', 'FETCHED', 'FAILED', 'EXCLUDED');

-- CreateEnum
CREATE TYPE "ProfileDiscoveryMethod" AS ENUM ('SAMEAS', 'LINK_SCAN', 'SERP');

-- CreateEnum
CREATE TYPE "SocialVerificationStatus" AS ENUM ('VERIFIED', 'PROBABLE', 'POSSIBLE', 'REJECTED');

-- CreateTable
CREATE TABLE "discovery_runs" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "status" "DiscoveryRunStatus" NOT NULL DEFAULT 'QUEUED',
    "stage" "DiscoveryStage",
    "pages_spent" INTEGER NOT NULL DEFAULT 0,
    "requests_spent" INTEGER NOT NULL DEFAULT 0,
    "chars_spent" INTEGER NOT NULL DEFAULT 0,
    "elapsed_ms" INTEGER NOT NULL DEFAULT 0,
    "overall_confidence" DOUBLE PRECISION,
    "overall_completeness" DOUBLE PRECISION,
    "profile_version" INTEGER NOT NULL DEFAULT 1,
    "error" TEXT,
    "notes" JSONB NOT NULL DEFAULT '[]',
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discovery_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discovered_pages" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "discovery_run_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "page_type" "PageType" NOT NULL,
    "classification_confidence" DOUBLE PRECISION,
    "priority_score" INTEGER,
    "fetch_status" "PageFetchStatus" NOT NULL DEFAULT 'PENDING',
    "cleaned_text" TEXT,
    "json_ld_raw" TEXT,
    "content_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discovered_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_profiles" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "platform" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "discovery_method" "ProfileDiscoveryMethod" NOT NULL,
    "score" INTEGER,
    "verification_status" "SocialVerificationStatus" NOT NULL,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_context_profiles" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "discovery_run_id" UUID NOT NULL,
    "profile_json" JSONB NOT NULL,
    "overall_confidence" DOUBLE PRECISION NOT NULL,
    "overall_completeness" DOUBLE PRECISION NOT NULL,
    "version" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_context_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "discovery_runs_project_id_idx" ON "discovery_runs"("project_id");

-- CreateIndex
CREATE INDEX "discovered_pages_project_id_idx" ON "discovered_pages"("project_id");

-- CreateIndex
CREATE INDEX "discovered_pages_discovery_run_id_idx" ON "discovered_pages"("discovery_run_id");

-- CreateIndex
CREATE INDEX "discovered_pages_url_idx" ON "discovered_pages"("url");

-- CreateIndex
CREATE INDEX "social_profiles_project_id_idx" ON "social_profiles"("project_id");

-- CreateIndex
CREATE INDEX "social_profiles_platform_idx" ON "social_profiles"("platform");

-- CreateIndex
CREATE INDEX "company_context_profiles_project_id_idx" ON "company_context_profiles"("project_id");

-- CreateIndex
CREATE INDEX "company_context_profiles_discovery_run_id_idx" ON "company_context_profiles"("discovery_run_id");

-- AddForeignKey
ALTER TABLE "discovery_runs" ADD CONSTRAINT "discovery_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovered_pages" ADD CONSTRAINT "discovered_pages_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovered_pages" ADD CONSTRAINT "discovered_pages_discovery_run_id_fkey" FOREIGN KEY ("discovery_run_id") REFERENCES "discovery_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_profiles" ADD CONSTRAINT "social_profiles_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_context_profiles" ADD CONSTRAINT "company_context_profiles_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_context_profiles" ADD CONSTRAINT "company_context_profiles_discovery_run_id_fkey" FOREIGN KEY ("discovery_run_id") REFERENCES "discovery_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
