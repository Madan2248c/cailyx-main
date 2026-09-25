-- Hand-written: partial unique index Prisma's schema DSL can't express
-- directly. See docs/analysis/projects.md for rationale.

-- A client's domain is unique among its non-deleted (active) projects, so
-- a domain can be reused after its project is archived, and the same
-- domain can appear under two different clients.
CREATE UNIQUE INDEX "projects_client_id_domain_active_key"
  ON "projects" ("client_id", "domain")
  WHERE "deleted_at" IS NULL;
