-- CreateEnum
CREATE TYPE "ReportKind" AS ENUM ('DAY1', 'MONTHLY');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'RELEASED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ReportVisibility" AS ENUM ('PRIVATE', 'PUBLIC');

-- CreateTable
CREATE TABLE "reports" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "kind" "ReportKind" NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'DRAFT',
    "visibility" "ReportVisibility" NOT NULL DEFAULT 'PRIVATE',
    "title" TEXT NOT NULL,
    "executive_summary" TEXT NOT NULL,
    "previous_report_id" UUID,
    "source_technical_audit_run_id" UUID,
    "source_social_activity_run_id" UUID,
    "source_aeo_audit_id" UUID,
    "source_gap_analysis_run_id" UUID,
    "released_revision_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMP(3),

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_revisions" (
    "id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "revision_number" INTEGER NOT NULL,
    "content_snapshot" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_share_links" (
    "id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_share_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reports_slug_key" ON "reports"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "reports_released_revision_id_key" ON "reports"("released_revision_id");

-- CreateIndex
CREATE INDEX "reports_project_id_idx" ON "reports"("project_id");

-- CreateIndex
CREATE INDEX "reports_previous_report_id_idx" ON "reports"("previous_report_id");

-- CreateIndex
CREATE INDEX "report_revisions_report_id_idx" ON "report_revisions"("report_id");

-- CreateIndex
CREATE UNIQUE INDEX "report_revisions_report_id_revision_number_key" ON "report_revisions"("report_id", "revision_number");

-- CreateIndex
CREATE UNIQUE INDEX "report_share_links_token_key" ON "report_share_links"("token");

-- CreateIndex
CREATE INDEX "report_share_links_report_id_idx" ON "report_share_links"("report_id");

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_previous_report_id_fkey" FOREIGN KEY ("previous_report_id") REFERENCES "reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_source_technical_audit_run_id_fkey" FOREIGN KEY ("source_technical_audit_run_id") REFERENCES "technical_audit_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_source_social_activity_run_id_fkey" FOREIGN KEY ("source_social_activity_run_id") REFERENCES "social_activity_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_source_aeo_audit_id_fkey" FOREIGN KEY ("source_aeo_audit_id") REFERENCES "aeo_audits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_source_gap_analysis_run_id_fkey" FOREIGN KEY ("source_gap_analysis_run_id") REFERENCES "gap_analysis_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_released_revision_id_fkey" FOREIGN KEY ("released_revision_id") REFERENCES "report_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_revisions" ADD CONSTRAINT "report_revisions_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_share_links" ADD CONSTRAINT "report_share_links_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
