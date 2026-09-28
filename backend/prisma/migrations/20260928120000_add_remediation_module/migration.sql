-- CreateEnum
CREATE TYPE "RemediationRunStatus" AS ENUM ('RUNNING', 'COMPLETE', 'FAILED');

-- CreateEnum
CREATE TYPE "FixClass" AS ENUM ('CODE', 'CONFIG', 'CONTENT', 'OFF_SITE', 'INVESTIGATE');

-- CreateEnum
CREATE TYPE "FixMethod" AS ENUM ('GENERATED', 'LLM_DRAFT', 'INSTRUCTIONS', 'HUMAN');

-- CreateEnum
CREATE TYPE "FixLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "FixStatus" AS ENUM ('OPEN', 'AWAITING_DECISION', 'IN_PROGRESS', 'APPLIED', 'VERIFIED', 'REGRESSED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "FixDecision" AS ENUM ('APPROVED', 'DECLINED');

-- CreateTable
CREATE TABLE "remediation_runs" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "status" "RemediationRunStatus" NOT NULL DEFAULT 'RUNNING',
    "source_technical_audit_run_id" UUID,
    "source_social_activity_run_id" UUID,
    "source_aeo_audit_id" UUID,
    "source_gap_analysis_run_id" UUID,
    "created_count" INTEGER NOT NULL DEFAULT 0,
    "updated_count" INTEGER NOT NULL DEFAULT 0,
    "verified_count" INTEGER NOT NULL DEFAULT 0,
    "regressed_count" INTEGER NOT NULL DEFAULT 0,
    "dropped_drafts" JSONB NOT NULL DEFAULT '[]',
    "triggered_by" UUID,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "remediation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fix_specs" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "problem_key" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "fix_class" "FixClass" NOT NULL,
    "method" "FixMethod" NOT NULL,
    "group_key" TEXT NOT NULL,
    "severity" "FixLevel" NOT NULL,
    "effort" "FixLevel" NOT NULL,
    "title" TEXT NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "artifact" JSONB,
    "artifact_error" TEXT,
    "steps" JSONB NOT NULL DEFAULT '[]',
    "acceptance" JSONB NOT NULL,
    "llm_draft" JSONB,
    "needs_client_decision" BOOLEAN NOT NULL DEFAULT false,
    "decision" "FixDecision",
    "decision_note" TEXT,
    "status" "FixStatus" NOT NULL DEFAULT 'OPEN',
    "gap_recommendation_id" UUID,
    "pr_url" TEXT,
    "dismissed_reason" TEXT,
    "last_reported_at" TIMESTAMP(3) NOT NULL,
    "last_verified_at" TIMESTAMP(3),
    "last_verify_result" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fix_specs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fix_spec_sources" (
    "id" UUID NOT NULL,
    "fix_spec_id" UUID NOT NULL,
    "module" TEXT NOT NULL,
    "run_id" UUID NOT NULL,
    "finding_ref" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fix_spec_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fix_spec_events" (
    "id" UUID NOT NULL,
    "fix_spec_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "from_status" "FixStatus",
    "to_status" "FixStatus",
    "actor" TEXT NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fix_spec_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "remediation_runs_project_id_idx" ON "remediation_runs"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "fix_specs_fingerprint_key" ON "fix_specs"("fingerprint");

-- CreateIndex
CREATE INDEX "fix_specs_project_id_status_idx" ON "fix_specs"("project_id", "status");

-- CreateIndex
CREATE INDEX "fix_specs_project_id_group_key_idx" ON "fix_specs"("project_id", "group_key");

-- CreateIndex
CREATE UNIQUE INDEX "fix_spec_sources_fix_spec_id_module_finding_ref_key" ON "fix_spec_sources"("fix_spec_id", "module", "finding_ref");

-- CreateIndex
CREATE INDEX "fix_spec_events_fix_spec_id_idx" ON "fix_spec_events"("fix_spec_id");

-- AddForeignKey
ALTER TABLE "remediation_runs" ADD CONSTRAINT "remediation_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fix_specs" ADD CONSTRAINT "fix_specs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fix_spec_sources" ADD CONSTRAINT "fix_spec_sources_fix_spec_id_fkey" FOREIGN KEY ("fix_spec_id") REFERENCES "fix_specs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fix_spec_events" ADD CONSTRAINT "fix_spec_events_fix_spec_id_fkey" FOREIGN KEY ("fix_spec_id") REFERENCES "fix_specs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

