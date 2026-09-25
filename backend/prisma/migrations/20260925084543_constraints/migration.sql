-- Hand-written: constraints Prisma's schema DSL can't express directly.
-- See docs/analysis/auth.md for rationale.

-- Email is unique among non-deleted users, so a soft-deleted user's email
-- can be re-invited. The application layer is responsible for always
-- normalizing email to lowercase before every read and write.
CREATE UNIQUE INDEX "users_email_active_key"
  ON "users" ("email")
  WHERE "deleted_at" IS NULL;

-- Exactly one active (non-deleted, non-disabled) POC per client.
CREATE UNIQUE INDEX "users_one_active_poc_per_client"
  ON "users" ("client_id")
  WHERE "role" = 'CLIENT_POC' AND "status" <> 'DISABLED' AND "deleted_at" IS NULL;

-- client_id is set iff the user is not an ADMIN.
ALTER TABLE "users"
  ADD CONSTRAINT "users_client_id_matches_role_chk"
  CHECK (("client_id" IS NULL) = ("role" = 'ADMIN'));

-- A role's permission grants are unique among non-revoked (non-deleted) rows,
-- so a permission can be re-granted to a role after being revoked.
CREATE UNIQUE INDEX "role_permissions_active_key"
  ON "role_permissions" ("role", "permission_id")
  WHERE "deleted_at" IS NULL;

-- A client's feature-flag key is unique among non-deleted rows.
CREATE UNIQUE INDEX "client_feature_flags_active_key"
  ON "client_feature_flags" ("client_id", "feature_key")
  WHERE "deleted_at" IS NULL;

-- A token hash is unique among non-deleted (non-revoked) tokens, so a
-- resend can soft-delete the old token and issue a fresh one without a
-- hash collision against history.
CREATE UNIQUE INDEX "auth_tokens_token_hash_active_key"
  ON "auth_tokens" ("token_hash")
  WHERE "deleted_at" IS NULL;

CREATE UNIQUE INDEX "refresh_tokens_token_hash_active_key"
  ON "refresh_tokens" ("token_hash")
  WHERE "deleted_at" IS NULL;
