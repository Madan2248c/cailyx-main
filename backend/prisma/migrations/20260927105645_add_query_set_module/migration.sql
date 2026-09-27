-- CreateEnum
CREATE TYPE "QuerySetStatus" AS ENUM ('draft', 'active', 'archived');

-- CreateEnum
CREATE TYPE "QuerySetSource" AS ENUM ('manual', 'sales_questions', 'support_tickets', 'llm_generated');

-- CreateEnum
CREATE TYPE "FunnelStage" AS ENUM ('problem_aware', 'solution_aware', 'product_aware', 'most_aware');

-- CreateEnum
CREATE TYPE "PromptBranding" AS ENUM ('branded', 'unbranded');

-- CreateEnum
CREATE TYPE "PromptPersona" AS ENUM ('buyer', 'researcher', 'end_user', 'evaluator');

-- CreateEnum
CREATE TYPE "QuerySetItemGenerationMethod" AS ENUM ('llm_generated', 'manual');

-- CreateTable
CREATE TABLE "query_sets" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "label" TEXT,
    "status" "QuerySetStatus" NOT NULL DEFAULT 'draft',
    "source" "QuerySetSource" NOT NULL DEFAULT 'manual',
    "generation_context_id" UUID,
    "generation_tier" TEXT,
    "activated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "query_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "query_set_buckets" (
    "id" UUID NOT NULL,
    "query_set_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "persona" "PromptPersona" NOT NULL,
    "funnel_stage" "FunnelStage" NOT NULL,
    "branding" "PromptBranding" NOT NULL,
    "target_count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "query_set_buckets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "query_set_items" (
    "id" UUID NOT NULL,
    "query_set_id" UUID NOT NULL,
    "bucket_id" UUID,
    "prompt" TEXT NOT NULL,
    "funnel_stage" "FunnelStage" NOT NULL,
    "branding" "PromptBranding",
    "generation_method" "QuerySetItemGenerationMethod" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "query_set_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "query_sets_project_id_idx" ON "query_sets"("project_id");

-- CreateIndex
CREATE INDEX "query_sets_generation_context_id_idx" ON "query_sets"("generation_context_id");

-- CreateIndex
CREATE INDEX "query_set_buckets_query_set_id_idx" ON "query_set_buckets"("query_set_id");

-- CreateIndex
CREATE INDEX "query_set_items_query_set_id_idx" ON "query_set_items"("query_set_id");

-- CreateIndex
CREATE INDEX "query_set_items_bucket_id_idx" ON "query_set_items"("bucket_id");

-- AddForeignKey
ALTER TABLE "query_sets" ADD CONSTRAINT "query_sets_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "query_sets" ADD CONSTRAINT "query_sets_generation_context_id_fkey" FOREIGN KEY ("generation_context_id") REFERENCES "company_context_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "query_set_buckets" ADD CONSTRAINT "query_set_buckets_query_set_id_fkey" FOREIGN KEY ("query_set_id") REFERENCES "query_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "query_set_items" ADD CONSTRAINT "query_set_items_query_set_id_fkey" FOREIGN KEY ("query_set_id") REFERENCES "query_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "query_set_items" ADD CONSTRAINT "query_set_items_bucket_id_fkey" FOREIGN KEY ("bucket_id") REFERENCES "query_set_buckets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
