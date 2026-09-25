-- CreateEnum
CREATE TYPE "TechnicalAuditStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETE', 'FAILED');

-- CreateEnum
CREATE TYPE "AuditTrigger" AS ENUM ('MANUAL', 'SCHEDULED');

-- CreateEnum
CREATE TYPE "AuditCadence" AS ENUM ('WEEKLY', 'MONTHLY', 'MANUAL_ONLY');

-- CreateTable
CREATE TABLE "technical_audit_runs" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "status" "TechnicalAuditStatus" NOT NULL DEFAULT 'QUEUED',
    "triggered_by" "AuditTrigger" NOT NULL,
    "previous_audit_id" UUID,
    "score" INTEGER,
    "result" JSONB NOT NULL DEFAULT '{}',
    "findings" JSONB NOT NULL DEFAULT '[]',
    "deltas" JSONB NOT NULL DEFAULT '[]',
    "narrative" TEXT,
    "narrative_model" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "technical_audit_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_pages" (
    "id" UUID NOT NULL,
    "technical_audit_run_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "status_code" INTEGER NOT NULL,
    "score" INTEGER NOT NULL,
    "issues" JSONB NOT NULL DEFAULT '[]',
    "signals" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "technical_audit_schedules" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "cadence" "AuditCadence" NOT NULL DEFAULT 'MANUAL_ONLY',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "technical_audit_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "technical_audit_runs_project_id_idx" ON "technical_audit_runs"("project_id");

-- CreateIndex
CREATE INDEX "technical_audit_runs_previous_audit_id_idx" ON "technical_audit_runs"("previous_audit_id");

-- CreateIndex
CREATE INDEX "audit_pages_technical_audit_run_id_idx" ON "audit_pages"("technical_audit_run_id");

-- CreateIndex
CREATE INDEX "audit_pages_project_id_idx" ON "audit_pages"("project_id");

-- CreateIndex
CREATE INDEX "audit_pages_url_idx" ON "audit_pages"("url");

-- CreateIndex
CREATE UNIQUE INDEX "technical_audit_schedules_project_id_key" ON "technical_audit_schedules"("project_id");

-- AddForeignKey
ALTER TABLE "technical_audit_runs" ADD CONSTRAINT "technical_audit_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "technical_audit_runs" ADD CONSTRAINT "technical_audit_runs_previous_audit_id_fkey" FOREIGN KEY ("previous_audit_id") REFERENCES "technical_audit_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_pages" ADD CONSTRAINT "audit_pages_technical_audit_run_id_fkey" FOREIGN KEY ("technical_audit_run_id") REFERENCES "technical_audit_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_pages" ADD CONSTRAINT "audit_pages_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "technical_audit_schedules" ADD CONSTRAINT "technical_audit_schedules_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
