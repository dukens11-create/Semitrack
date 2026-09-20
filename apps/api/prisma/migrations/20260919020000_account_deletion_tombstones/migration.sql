-- No hard deletion of users or business/safety/fleet history. No guessed retention duration.
CREATE TABLE "AccountDeletionTombstone" (
  "userId" TEXT NOT NULL PRIMARY KEY,
  "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "policyState" TEXT NOT NULL DEFAULT 'POLICY_REQUIRED',
  "policyVersion" INTEGER NOT NULL DEFAULT 1,
  "retainedCategories" TEXT[] NOT NULL DEFAULT ARRAY['financial','fleet','safety','audit','disputes','backups']::TEXT[]
);
-- No User foreign key: tombstones must survive an account-table restore/removal.
CREATE FUNCTION enforce_deleted_account() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE deleted_at TIMESTAMP(3);
BEGIN
  SELECT "deletedAt" INTO deleted_at FROM "AccountDeletionTombstone" WHERE "userId" = NEW.id;
  IF FOUND THEN
    NEW.email := 'deleted+' || md5(NEW.id) || '@account.invalid';
    NEW."fullName" := 'Deleted account';
    NEW.phone := NULL;
    NEW."passwordHash" := '!ACCOUNT_DELETED!';
    NEW."disabledAt" := deleted_at;
    NEW."emailVerified" := false;
    NEW.role := 'DRIVER';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER preserve_account_erasure BEFORE INSERT OR UPDATE ON "User"
FOR EACH ROW EXECUTE FUNCTION enforce_deleted_account();

CREATE TABLE "AccountRetentionPolicy" (
  "category" TEXT NOT NULL PRIMARY KEY,
  "retentionDays" INTEGER,
  "approvedReference" TEXT,
  "approvedAt" TIMESTAMP(3),
  CONSTRAINT "retention_requires_approval" CHECK (
    ("retentionDays" IS NULL AND "approvedReference" IS NULL AND "approvedAt" IS NULL)
    OR ("retentionDays" IS NOT NULL AND "retentionDays" >= 0 AND "approvedReference" IS NOT NULL AND length(trim("approvedReference")) > 0 AND "approvedAt" IS NOT NULL)
  )
);
INSERT INTO "AccountRetentionPolicy" ("category")
VALUES ('financial'),('fleet'),('safety'),('audit'),('disputes'),('backups');
CREATE FUNCTION reject_deleted_personal_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM "User" WHERE id = NEW."userId" FOR UPDATE;
  IF EXISTS (SELECT 1 FROM "AccountDeletionTombstone" WHERE "userId" = NEW."userId") THEN
    RAISE EXCEPTION 'ACCOUNT_DELETED' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER reject_deleted_preferences BEFORE INSERT OR UPDATE ON "NavigationSettings"
FOR EACH ROW EXECUTE FUNCTION reject_deleted_personal_write();
CREATE TRIGGER reject_deleted_favorites BEFORE INSERT OR UPDATE ON "Favorite"
FOR EACH ROW EXECUTE FUNCTION reject_deleted_personal_write();
CREATE TRIGGER reject_deleted_documents BEFORE INSERT OR UPDATE ON "Document"
FOR EACH ROW EXECUTE FUNCTION reject_deleted_personal_write();
CREATE TRIGGER reject_deleted_oauth BEFORE INSERT OR UPDATE ON "EldOAuthState"
FOR EACH ROW EXECUTE FUNCTION reject_deleted_personal_write();
CREATE FUNCTION sanitize_deleted_eld_connection() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM "User" WHERE id = NEW."userId" FOR UPDATE;
  IF EXISTS (SELECT 1 FROM "AccountDeletionTombstone" WHERE "userId" = NEW."userId") THEN
    NEW."encryptedAccessToken" := NULL; NEW."encryptedRefreshToken" := NULL;
    NEW."providerAccountId" := NULL; NEW."accessTokenExpiresAt" := NULL;
    NEW."metadataJson" := NULL; NEW.scopes := ARRAY[]::TEXT[];
    NEW.status := 'DISCONNECTED'; NEW."lastErrorCode" := NULL; NEW."lastErrorMessage" := NULL;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sanitize_deleted_eld BEFORE INSERT OR UPDATE ON "EldConnection"
FOR EACH ROW EXECUTE FUNCTION sanitize_deleted_eld_connection();
