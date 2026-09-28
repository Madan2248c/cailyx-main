-- Remediation client access (docs/analysis/remediation-client-portal.md §4.3, §4.4).
-- Additive and idempotent: safe to re-run.

-- Staff-controlled visibility of LLM copy drafts to the client.
ALTER TABLE "fix_specs" ADD COLUMN IF NOT EXISTS "draft_shared" BOOLEAN NOT NULL DEFAULT false;

-- New permissions (same catalog prisma/seed.ts maintains).
INSERT INTO "permissions" ("id", "key", "description")
VALUES
  (gen_random_uuid(), 'decide_fixes', 'Approve or decline Fix Plan items that need the client''s decision.'),
  (gen_random_uuid(), 'update_fixes', 'Mark Fix Plan items as applied and request a re-check.')
ON CONFLICT ("key") DO NOTHING;

-- Grants: POC decides and updates; members update only.
INSERT INTO "role_permissions" ("id", "role", "permission_id")
SELECT gen_random_uuid(), g.role::"Role", p."id"
FROM (VALUES ('CLIENT_POC', 'decide_fixes'), ('CLIENT_POC', 'update_fixes'), ('CLIENT_MEMBER', 'update_fixes')) AS g(role, key)
JOIN "permissions" p ON p."key" = g.key
WHERE NOT EXISTS (
  SELECT 1 FROM "role_permissions" rp
  WHERE rp."role" = g.role::"Role" AND rp."permission_id" = p."id" AND rp."deleted_at" IS NULL
);
