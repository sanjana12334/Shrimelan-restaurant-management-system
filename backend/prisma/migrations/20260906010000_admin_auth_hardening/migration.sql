-- ============================================================================
-- Phase 2 migration: admin auth hardening
-- Non-destructive — adds columns only, all with safe defaults.
-- ============================================================================

ALTER TABLE "Staff" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Staff" ADD COLUMN "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Staff" ADD COLUMN "lockedUntil" TIMESTAMP(3);
ALTER TABLE "Staff" ADD COLUMN "lastLoginAt" TIMESTAMP(3);
