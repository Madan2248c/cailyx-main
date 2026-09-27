-- CreateEnum
CREATE TYPE "DataforseoCadence" AS ENUM ('WEEKLY', 'MONTHLY', 'MANUAL_ONLY');

-- CreateTable
CREATE TABLE "dataforseo_schedules" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "cadence" "DataforseoCadence" NOT NULL DEFAULT 'MANUAL_ONLY',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "datasets" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "next_run_at" TIMESTAMP(3),
    "spend_opt_in" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dataforseo_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dataforseo_snapshots" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "dataset" TEXT NOT NULL,
    "period_start" TIMESTAMP(3),
    "period_end" TIMESTAMP(3),
    "payload" JSONB NOT NULL,
    "cost_usd" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dataforseo_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dataforseo_schedules_project_id_key" ON "dataforseo_schedules"("project_id");

-- CreateIndex
CREATE INDEX "dataforseo_snapshots_project_id_idx" ON "dataforseo_snapshots"("project_id");

-- CreateIndex
CREATE INDEX "dataforseo_snapshots_project_id_dataset_idx" ON "dataforseo_snapshots"("project_id", "dataset");

-- AddForeignKey
ALTER TABLE "dataforseo_schedules" ADD CONSTRAINT "dataforseo_schedules_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataforseo_snapshots" ADD CONSTRAINT "dataforseo_snapshots_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
