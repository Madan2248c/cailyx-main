-- CreateEnum
CREATE TYPE "AeoAuditStatus" AS ENUM ('pending', 'running', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "AeoSurfaceRunStatus" AS ENUM ('pending', 'running', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "Stance" AS ENUM ('recommended_primary', 'recommended_alternative', 'mentioned_neutral', 'mentioned_negative', 'absent');

-- CreateEnum
CREATE TYPE "CompetitorStatus" AS ENUM ('tracked', 'candidate');

-- CreateEnum
CREATE TYPE "CompetitorSource" AS ENUM ('manual', 'stance_discovered');

-- CreateTable
CREATE TABLE "aeo_audits" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "query_set_id" UUID NOT NULL,
    "surfaces" "MeasurementSurface"[],
    "markets" TEXT[] DEFAULT ARRAY['US']::TEXT[],
    "status" "AeoAuditStatus" NOT NULL DEFAULT 'pending',
    "prompt_count" INTEGER NOT NULL DEFAULT 0,
    "observations" INTEGER NOT NULL DEFAULT 0,
    "stance_judged" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "error" TEXT,
    "verdict" JSONB NOT NULL DEFAULT '{}',
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aeo_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aeo_surface_runs" (
    "id" UUID NOT NULL,
    "audit_id" UUID NOT NULL,
    "surface" "MeasurementSurface" NOT NULL,
    "market" TEXT NOT NULL,
    "measurement_run_id" UUID,
    "status" "AeoSurfaceRunStatus" NOT NULL DEFAULT 'pending',
    "observations" INTEGER NOT NULL DEFAULT 0,
    "stance_judged" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "failure_kind" TEXT,
    "error" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aeo_surface_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aeo_stances" (
    "id" UUID NOT NULL,
    "audit_id" UUID NOT NULL,
    "observation_id" UUID NOT NULL,
    "surface" "MeasurementSurface" NOT NULL,
    "stance" "Stance" NOT NULL,
    "rank_among_brands" INTEGER,
    "brands_named" TEXT[],
    "recommended_over" TEXT[],
    "loses_to" TEXT[],
    "other_names_seen" TEXT[],
    "evidence_quote" TEXT,
    "rationale" TEXT,
    "judge_model" TEXT NOT NULL,
    "cost_usd" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aeo_stances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competitors" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "status" "CompetitorStatus" NOT NULL DEFAULT 'tracked',
    "source" "CompetitorSource" NOT NULL DEFAULT 'manual',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "competitors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "aeo_audits_project_id_idx" ON "aeo_audits"("project_id");

-- CreateIndex
CREATE INDEX "aeo_audits_query_set_id_idx" ON "aeo_audits"("query_set_id");

-- CreateIndex
CREATE INDEX "aeo_surface_runs_audit_id_idx" ON "aeo_surface_runs"("audit_id");

-- CreateIndex
CREATE UNIQUE INDEX "aeo_surface_runs_audit_id_surface_market_key" ON "aeo_surface_runs"("audit_id", "surface", "market");

-- CreateIndex
CREATE UNIQUE INDEX "aeo_stances_observation_id_key" ON "aeo_stances"("observation_id");

-- CreateIndex
CREATE INDEX "aeo_stances_audit_id_idx" ON "aeo_stances"("audit_id");

-- CreateIndex
CREATE INDEX "competitors_project_id_idx" ON "competitors"("project_id");

-- AddForeignKey
ALTER TABLE "aeo_audits" ADD CONSTRAINT "aeo_audits_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aeo_audits" ADD CONSTRAINT "aeo_audits_query_set_id_fkey" FOREIGN KEY ("query_set_id") REFERENCES "query_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aeo_surface_runs" ADD CONSTRAINT "aeo_surface_runs_audit_id_fkey" FOREIGN KEY ("audit_id") REFERENCES "aeo_audits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aeo_surface_runs" ADD CONSTRAINT "aeo_surface_runs_measurement_run_id_fkey" FOREIGN KEY ("measurement_run_id") REFERENCES "measurement_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aeo_stances" ADD CONSTRAINT "aeo_stances_audit_id_fkey" FOREIGN KEY ("audit_id") REFERENCES "aeo_audits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aeo_stances" ADD CONSTRAINT "aeo_stances_observation_id_fkey" FOREIGN KEY ("observation_id") REFERENCES "observations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
