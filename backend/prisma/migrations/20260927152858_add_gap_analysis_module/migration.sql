-- CreateEnum
CREATE TYPE "GapAnalysisStatus" AS ENUM ('RUNNING', 'COMPLETE', 'FAILED');

-- CreateEnum
CREATE TYPE "RecommendationStatus" AS ENUM ('OPEN', 'DONE', 'DISMISSED');

-- CreateTable
CREATE TABLE "gap_analysis_runs" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "status" "GapAnalysisStatus" NOT NULL DEFAULT 'RUNNING',
    "source_technical_audit_run_id" UUID,
    "source_social_activity_run_id" UUID,
    "source_aeo_audit_id" UUID,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "gap_analysis_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gap_analysis_recommendations" (
    "id" UUID NOT NULL,
    "gap_analysis_run_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priority_rank" INTEGER NOT NULL,
    "source_findings" JSONB NOT NULL DEFAULT '[]',
    "status" "RecommendationStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gap_analysis_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gap_analysis_runs_project_id_idx" ON "gap_analysis_runs"("project_id");

-- CreateIndex
CREATE INDEX "gap_analysis_recommendations_gap_analysis_run_id_idx" ON "gap_analysis_recommendations"("gap_analysis_run_id");

-- AddForeignKey
ALTER TABLE "gap_analysis_runs" ADD CONSTRAINT "gap_analysis_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gap_analysis_runs" ADD CONSTRAINT "gap_analysis_runs_source_technical_audit_run_id_fkey" FOREIGN KEY ("source_technical_audit_run_id") REFERENCES "technical_audit_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gap_analysis_runs" ADD CONSTRAINT "gap_analysis_runs_source_social_activity_run_id_fkey" FOREIGN KEY ("source_social_activity_run_id") REFERENCES "social_activity_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gap_analysis_runs" ADD CONSTRAINT "gap_analysis_runs_source_aeo_audit_id_fkey" FOREIGN KEY ("source_aeo_audit_id") REFERENCES "aeo_audits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gap_analysis_recommendations" ADD CONSTRAINT "gap_analysis_recommendations_gap_analysis_run_id_fkey" FOREIGN KEY ("gap_analysis_run_id") REFERENCES "gap_analysis_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
