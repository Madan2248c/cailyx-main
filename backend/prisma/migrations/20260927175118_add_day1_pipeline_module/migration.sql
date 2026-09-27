-- CreateEnum
CREATE TYPE "Day1PipelineStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETE', 'FAILED');

-- CreateTable
CREATE TABLE "day1_pipeline_runs" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "status" "Day1PipelineStatus" NOT NULL DEFAULT 'QUEUED',
    "current_stage" TEXT,
    "stages" JSONB NOT NULL DEFAULT '{}',
    "spend_ceiling_usd" DOUBLE PRECISION,
    "spend_authorized_at" TIMESTAMP(3) NOT NULL,
    "report_id" UUID,
    "error" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "day1_pipeline_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "day1_pipeline_runs_project_id_key" ON "day1_pipeline_runs"("project_id");

-- CreateIndex
CREATE INDEX "day1_pipeline_runs_client_id_idx" ON "day1_pipeline_runs"("client_id");

-- AddForeignKey
ALTER TABLE "day1_pipeline_runs" ADD CONSTRAINT "day1_pipeline_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
