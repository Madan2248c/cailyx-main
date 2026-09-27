-- CreateEnum
CREATE TYPE "CompetitorProfileFetchStatus" AS ENUM ('OK', 'FAILED');

-- AlterEnum
ALTER TYPE "CompetitorSource" ADD VALUE 'serp_discovered';

-- CreateTable
CREATE TABLE "competitor_profiles" (
    "id" UUID NOT NULL,
    "competitor_id" UUID,
    "project_id" UUID NOT NULL,
    "tech_stack_findings" JSONB NOT NULL DEFAULT '[]',
    "schema_types" JSONB NOT NULL DEFAULT '[]',
    "seo_score" INTEGER,
    "seo_issues" JSONB NOT NULL DEFAULT '[]',
    "review_rating" JSONB,
    "fetch_status" "CompetitorProfileFetchStatus" NOT NULL,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "competitor_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "competitor_profiles_competitor_id_idx" ON "competitor_profiles"("competitor_id");

-- CreateIndex
CREATE INDEX "competitor_profiles_project_id_idx" ON "competitor_profiles"("project_id");

-- AddForeignKey
ALTER TABLE "competitor_profiles" ADD CONSTRAINT "competitor_profiles_competitor_id_fkey" FOREIGN KEY ("competitor_id") REFERENCES "competitors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competitor_profiles" ADD CONSTRAINT "competitor_profiles_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
