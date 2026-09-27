-- CreateEnum
CREATE TYPE "MeasurementRunStatus" AS ENUM ('pending', 'running', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "MeasurementSurface" AS ENUM ('cloro_chatgpt', 'cloro_perplexity', 'cloro_gemini', 'cloro_ai_overview', 'cloro_ai_mode', 'mock');

-- CreateTable
CREATE TABLE "measurement_runs" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "query_set_id" UUID NOT NULL,
    "surface" "MeasurementSurface" NOT NULL,
    "geo" TEXT NOT NULL DEFAULT 'US',
    "run_count" INTEGER NOT NULL DEFAULT 1,
    "status" "MeasurementRunStatus" NOT NULL DEFAULT 'pending',
    "total_requests" INTEGER NOT NULL DEFAULT 0,
    "completed_requests" INTEGER NOT NULL DEFAULT 0,
    "failed_requests" INTEGER NOT NULL DEFAULT 0,
    "cost_total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "error" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "measurement_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "observations" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "run_number" INTEGER NOT NULL,
    "prompt" TEXT NOT NULL,
    "mentioned" BOOLEAN NOT NULL,
    "cited" BOOLEAN NOT NULL,
    "cited_url" TEXT,
    "position" INTEGER,
    "characterization" TEXT NOT NULL,
    "raw_answer" TEXT NOT NULL,
    "cost_usd" DOUBLE PRECISION NOT NULL,
    "latency_ms" INTEGER NOT NULL,
    "model" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "observations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "measurement_runs_project_id_idx" ON "measurement_runs"("project_id");

-- CreateIndex
CREATE INDEX "measurement_runs_query_set_id_idx" ON "measurement_runs"("query_set_id");

-- CreateIndex
CREATE INDEX "observations_run_id_idx" ON "observations"("run_id");

-- CreateIndex
CREATE INDEX "observations_item_id_idx" ON "observations"("item_id");

-- AddForeignKey
ALTER TABLE "measurement_runs" ADD CONSTRAINT "measurement_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement_runs" ADD CONSTRAINT "measurement_runs_query_set_id_fkey" FOREIGN KEY ("query_set_id") REFERENCES "query_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observations" ADD CONSTRAINT "observations_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "measurement_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observations" ADD CONSTRAINT "observations_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "query_set_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
