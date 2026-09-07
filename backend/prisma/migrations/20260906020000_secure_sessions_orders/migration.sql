-- Secure session storage, scoped idempotency, historical variant snapshots, and
-- database-level numeric invariants.

CREATE TABLE "AdminSession" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "ipAddress" TEXT,
    CONSTRAINT "AdminSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminSession_tokenHash_key" ON "AdminSession"("tokenHash");
CREATE INDEX "AdminSession_staffId_revokedAt_idx" ON "AdminSession"("staffId", "revokedAt");
CREATE INDEX "AdminSession_expiresAt_idx" ON "AdminSession"("expiresAt");
ALTER TABLE "AdminSession"
  ADD CONSTRAINT "AdminSession_staffId_fkey"
  FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TableSession" ADD COLUMN "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "Order" ADD COLUMN "idempotencyScope" TEXT;
DROP INDEX IF EXISTS "Order_idempotencyKey_key";
CREATE UNIQUE INDEX "Order_idempotencyScope_idempotencyKey_key"
  ON "Order"("idempotencyScope", "idempotencyKey");

ALTER TABLE "OrderItem" ADD COLUMN "variantNameSnap" TEXT;

ALTER TABLE "MenuItem"
  ADD CONSTRAINT "MenuItem_price_nonnegative" CHECK ("price" >= 0);
ALTER TABLE "ItemAddon"
  ADD CONSTRAINT "ItemAddon_price_nonnegative" CHECK ("price" >= 0);
ALTER TABLE "CartItem"
  ADD CONSTRAINT "CartItem_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "Order"
  ADD CONSTRAINT "Order_amounts_nonnegative" CHECK ("subtotal" >= 0 AND "tax" >= 0 AND "total" >= 0);
ALTER TABLE "OrderItem"
  ADD CONSTRAINT "OrderItem_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "OrderItem"
  ADD CONSTRAINT "OrderItem_unitPriceSnap_nonnegative" CHECK ("unitPriceSnap" >= 0);
