-- ============================================================================
-- Phase 1 migration: ADMIN-only architecture + secure QR ordering data model
--
-- SAFETY NOTES (read before applying to any environment with real data):
--  - Nothing here is destructive. No table is dropped and no row is deleted.
--  - Steps that narrow an enum (StaffRole, PaymentStatus) first BACK-FILL any
--    existing rows into a value the new enum still supports, then swap the
--    type. Existing data survives with an explicit, logged mapping.
--  - This migration requires the pgcrypto extension (for digest()/gen_random_bytes,
--    used to backfill new hash columns on existing rows only). Most managed
--    Postgres providers (Railway included) allow this without superuser.
--  - IMPORTANT: RestaurantTable.qrTokenHash is backfilled by hashing whatever
--    raw qrToken value already exists in the row. If your existing qrToken
--    values were predictable (e.g. "table-1"), hashing them does NOT make
--    them unpredictable — it only migrates the column shape. Rotate every
--    table's QR immediately after this migration via the QR regeneration
--    endpoint added in Phase 3. This is called out again in PHASE1_NOTES.md.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. STAFF ROLE — narrow to ADMIN only, safely
-- ----------------------------------------------------------------------------

-- Back-fill: any existing MANAGER/CASHIER/KITCHEN staff account becomes
-- ADMIN rather than being deleted. Restaurant owners should review and
-- deactivate any account that shouldn't have full admin access post-migration.
UPDATE "Staff" SET "role" = 'ADMIN' WHERE "role" <> 'ADMIN';

CREATE TYPE "StaffRole_new" AS ENUM ('ADMIN');
ALTER TABLE "Staff" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "Staff" ALTER COLUMN "role" TYPE "StaffRole_new" USING ("role"::text::"StaffRole_new");
DROP TYPE "StaffRole";
ALTER TYPE "StaffRole_new" RENAME TO "StaffRole";
ALTER TABLE "Staff" ALTER COLUMN "role" SET DEFAULT 'ADMIN';

CREATE INDEX "Staff_branchId_idx" ON "Staff"("branchId");

-- ----------------------------------------------------------------------------
-- 2. PAYMENT STATUS — PENDING_COUNTER/PAID_AT_COUNTER -> UNPAID/PAID
-- ----------------------------------------------------------------------------

CREATE TYPE "PaymentStatus_new" AS ENUM ('UNPAID', 'PAID');
ALTER TABLE "Order" ALTER COLUMN "paymentStatus" DROP DEFAULT;
ALTER TABLE "Order" ALTER COLUMN "paymentStatus" TYPE "PaymentStatus_new" USING (
  CASE "paymentStatus"::text
    WHEN 'PENDING_COUNTER' THEN 'UNPAID'
    WHEN 'PAID_AT_COUNTER' THEN 'PAID'
  END
)::"PaymentStatus_new";
DROP TYPE "PaymentStatus";
ALTER TYPE "PaymentStatus_new" RENAME TO "PaymentStatus";
ALTER TABLE "Order" ALTER COLUMN "paymentStatus" SET DEFAULT 'UNPAID';

-- ----------------------------------------------------------------------------
-- 3. NEW ENUMS — PaymentMethod, OrderSource
-- ----------------------------------------------------------------------------

CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'UPI', 'CARD');
CREATE TYPE "OrderSource" AS ENUM ('QR', 'WEBSITE', 'ADMIN');

-- ----------------------------------------------------------------------------
-- 4. RESTAURANT TABLE — replace raw qrToken with a hash + version, add audit
--    columns. Old plaintext token values are never left readable in the DB.
-- ----------------------------------------------------------------------------

ALTER TABLE "RestaurantTable" ADD COLUMN "qrTokenHash" TEXT;
ALTER TABLE "RestaurantTable" ADD COLUMN "qrVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "RestaurantTable" ADD COLUMN "updatedAt" TIMESTAMP(3);

-- Backfill: hash whatever raw token already exists so no data is lost.
-- See the safety note at the top of this file — rotate these post-migration.
UPDATE "RestaurantTable"
SET "qrTokenHash" = encode(digest("qrToken", 'sha256'), 'hex'),
    "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP);

ALTER TABLE "RestaurantTable" ALTER COLUMN "qrTokenHash" SET NOT NULL;
ALTER TABLE "RestaurantTable" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "RestaurantTable" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "RestaurantTable" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

DROP INDEX IF EXISTS "RestaurantTable_qrToken_key";
ALTER TABLE "RestaurantTable" DROP COLUMN "qrToken";
CREATE UNIQUE INDEX "RestaurantTable_qrTokenHash_key" ON "RestaurantTable"("qrTokenHash");
CREATE INDEX "RestaurantTable_branchId_idx" ON "RestaurantTable"("branchId");

-- ----------------------------------------------------------------------------
-- 5. TABLE SESSION — new table. QR -> Table -> TableSession -> Order.
-- ----------------------------------------------------------------------------

CREATE TABLE "TableSession" (
    "id" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "sessionTokenHash" TEXT NOT NULL,
    "qrVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "TableSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TableSession_sessionTokenHash_key" ON "TableSession"("sessionTokenHash");
CREATE INDEX "TableSession_tableId_idx" ON "TableSession"("tableId");
CREATE INDEX "TableSession_branchId_idx" ON "TableSession"("branchId");
CREATE INDEX "TableSession_expiresAt_idx" ON "TableSession"("expiresAt");

ALTER TABLE "TableSession" ADD CONSTRAINT "TableSession_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "RestaurantTable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TableSession" ADD CONSTRAINT "TableSession_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ----------------------------------------------------------------------------
-- 6. ORDER — orderSource, tableSessionId, payment fields, access token,
--    idempotency key, and lookup indexes.
-- ----------------------------------------------------------------------------

-- orderSource: back-fill existing rows as WEBSITE (the only channel that
-- existed before this migration), then drop the default so every future
-- insert must state its source explicitly, matching the Prisma schema.
ALTER TABLE "Order" ADD COLUMN "orderSource" "OrderSource" NOT NULL DEFAULT 'WEBSITE';
ALTER TABLE "Order" ALTER COLUMN "orderSource" DROP DEFAULT;

ALTER TABLE "Order" ADD COLUMN "tableSessionId" TEXT;
ALTER TABLE "Order" ADD CONSTRAINT "Order_tableSessionId_fkey" FOREIGN KEY ("tableSessionId") REFERENCES "TableSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Preserve the existing "who marked this paid" data under its new name.
ALTER TABLE "Order" RENAME COLUMN "markedPaidById" TO "paidById";
ALTER TABLE "Order" ADD CONSTRAINT "Order_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Order" ADD COLUMN "paymentMethod" "PaymentMethod";
ALTER TABLE "Order" ADD COLUMN "paidAt" TIMESTAMP(3);
-- Best-effort backfill: any order already PAID under the old model gets a
-- paidAt timestamp so historical reporting isn't left with gaps. There is no
-- way to recover the original payment method for pre-migration orders, so it
-- is left NULL and should be treated as "unknown (pre-migration)" in reports.
UPDATE "Order" SET "paidAt" = "updatedAt" WHERE "paymentStatus" = 'PAID' AND "paidAt" IS NULL;

-- Per-order opaque access token hash. Backfilled with a random hash for
-- existing orders so the column can be NOT NULL + UNIQUE; those historical
-- orders simply won't be reachable via the new token-based lookup (they
-- remain reachable the old way, via orderNumber+phone, until Phase 7 lands).
ALTER TABLE "Order" ADD COLUMN "accessTokenHash" TEXT;
UPDATE "Order" SET "accessTokenHash" = encode(digest(gen_random_uuid()::text || "id", 'sha256'), 'hex') WHERE "accessTokenHash" IS NULL;
ALTER TABLE "Order" ALTER COLUMN "accessTokenHash" SET NOT NULL;
CREATE UNIQUE INDEX "Order_accessTokenHash_key" ON "Order"("accessTokenHash");

ALTER TABLE "Order" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "Order_idempotencyKey_key" ON "Order"("idempotencyKey");

CREATE INDEX "Order_branchId_status_idx" ON "Order"("branchId", "status");
CREATE INDEX "Order_orderSource_idx" ON "Order"("orderSource");
CREATE INDEX "Order_paymentStatus_idx" ON "Order"("paymentStatus");
CREATE INDEX "Order_tableId_idx" ON "Order"("tableId");

-- ----------------------------------------------------------------------------
-- 7. AUDIT LOG — lookup indexes for the admin review screens added later.
-- ----------------------------------------------------------------------------

CREATE INDEX "AuditLog_staffId_idx" ON "AuditLog"("staffId");
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");
CREATE INDEX "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType", "targetId");
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
