-- Adds branch attribution to AuditLog so audit events can be filtered/
-- reported on per-branch (needed for every action the centralized audit
-- service now records: auth, staff/admin management, orders, payments,
-- menu, and tables/QR). Nullable because a small number of actions (e.g. a
-- failed login attempt for an email that matches no account) have no
-- branch to attach.

ALTER TABLE "AuditLog" ADD COLUMN "branchId" TEXT;

CREATE INDEX "AuditLog_branchId_idx" ON "AuditLog"("branchId");

ALTER TABLE "AuditLog"
  ADD CONSTRAINT "AuditLog_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
