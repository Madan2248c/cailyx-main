-- AlterTable
ALTER TABLE "discovered_pages" ADD COLUMN     "pipeline_state" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "discovery_runs" ADD COLUMN     "pipeline_state" JSONB NOT NULL DEFAULT '{}';
