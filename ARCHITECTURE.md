# ShriMelan — Current Architecture

This repository contains the existing ShriMelan customer preview and its
Express/Prisma backend. The backend is the source of truth for authorization,
branch selection, menu data, pricing, order state, payment state, and QR
sessions.

## Repository structure

```text
shrimelan-project/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── migrations/
│   └── src/
│       ├── config/env.ts
│       ├── middleware/
│       │   ├── auth.ts
│       │   ├── origin.ts
│       │   ├── table-session.ts
│       │   └── validate.ts
│       ├── routes/
│       │   ├── auth.routes.ts
│       │   ├── menu.routes.ts
│       │   ├── order.routes.ts
│       │   ├── staff-orders.routes.ts
│       │   └── table.routes.ts
│       ├── services/
│       │   ├── order-state.service.ts
│       │   └── pricing.service.ts
│       ├── security/tokens.ts
│       ├── sockets/io.ts
│       └── server.ts
├── shrimelan-preview/       # Existing static customer design reference
└── ARCHITECTURE.md
```

The preview is not the final customer ordering UI. The secure backend foundation
is intentionally implemented first.

## Authentication and authorization

There is exactly one authenticated staff role: `ADMIN`. Staff authenticate with
an HttpOnly cookie containing a signed JWT. Each JWT also identifies an
`AdminSession`; the database stores only the session token hash. A request is
accepted only when the staff account is active, still has role `ADMIN`, the
session is not revoked or expired, and the account session version matches.

Logout revokes the current session. A separate authenticated revoke-all action
increments the account session version and revokes all current sessions.
Production startup rejects missing or obvious placeholder secrets. Production
cookies are HttpOnly, Secure, and SameSite=Lax. Browser writes must come from a
configured origin, CORS is an explicit allow-list, and request logging redacts
cookies and authorization headers.

Every staff query derives `branchId` from the authenticated database-backed
staff session. Client-supplied branch identifiers are not accepted as
authorization data.

## Database model

- `Branch` owns staff, tables, menu categories, and orders.
- `Staff` has only `ADMIN` as a valid role.
- `RestaurantTable` stores only a SHA-256 hash of a 256-bit opaque QR token and
  a monotonically increasing `qrVersion`.
- `TableSession` stores only a hash of a short-lived opaque customer session
  token, plus table, branch, creation, expiry, revocation, and last-seen data.
- `Order` stores server-computed amounts, source, table/session traceability,
  payment state, an access-token hash, and scoped idempotency data.
- `OrderItem` stores item, variant, add-on, name, price, and quantity snapshots
  so later menu changes cannot rewrite historical orders.
- `OrderStatusHistory` records every status change.
- `AuditLog` records privileged actions, including authentication, QR changes,
  order status changes, and counter payment.

Foreign keys use restrictive behavior where deleting menu data could destroy
historical order meaning. Database checks enforce positive quantities and
non-negative stored monetary amounts.

## API surface

### Customer foundation

- `POST /api/public/table-session` accepts only a raw QR credential, validates
  it against the hash and active table, then creates a short-lived HttpOnly
  `TableSession` cookie.
- `GET /api/public/table-session` verifies that session.
- `GET /api/public/menu` requires a valid table session and returns only the
  session's branch menu and customer-safe fields.
- `POST /api/public/orders` requires a valid table session and an
  `Idempotency-Key`. The body may contain customer details, item/variant/add-on
  identifiers, quantities, and notes only. The server resolves branch/table,
  validates ownership and availability, computes price/tax/total, and creates
  the order, line snapshots, and initial history row in one transaction.
- `GET /api/public/orders/:orderNumber` requires the cryptographically random
  order access token in `X-Order-Access-Token`; order number alone never
  authorizes tracking.

Customer orders are guest/public and counter-payment only. Customer requests
cannot set payment status, payment method, paid time, payer, branch, table,
price, subtotal, tax, or total.

### Admin foundation

- `POST /api/auth/staff/login`
- `POST /api/auth/staff/logout`
- `POST /api/auth/staff/revoke-all`
- `GET /api/staff/orders`
- `PATCH /api/staff/orders/:id/status`
- `PATCH /api/staff/orders/:id/mark-paid`
- `GET /api/admin/tables`
- `POST /api/admin/tables`
- `POST /api/admin/tables/:id/qr/regenerate`

All admin endpoints require an active authenticated `ADMIN` session. Queries
and mutations are branch-scoped. QR creation and regeneration return the raw
credential exactly once; hashes are never returned.

## Order and payment state

The server enforces this order state machine:

```text
RECEIVED -> CONFIRMED -> PREPARING -> READY -> COMPLETED
    └──────────────-> CANCELLED
    CONFIRMED ──────> CANCELLED
```

Only the listed transitions are legal. Status update, history insertion, and
audit insertion share one database transaction.

Payment is independent of order status and is counter-only:
`UNPAID -> PAID`. Only an authenticated branch ADMIN can perform that transition,
and must provide `CASH`, `UPI`, or `CARD`. The server generates `paidAt` and
`paidById`; payment update and audit insertion are atomic. No online gateway is
used.

--- orig/shrimelan-project-new/ARCHITECTURE.md	2026-09-06 11:00:30.000000000 +0000
+++ shrimelan-project-new/ARCHITECTURE.md	2026-09-06 17:41:27.587324888 +0000
@@ -130,11 +130,16 @@
 Only the listed transitions are legal. Status update, history insertion, and
 audit insertion share one database transaction.
 
-Payment is independent of order status and is counter-only:
-`UNPAID -> PAID`. Only an authenticated branch ADMIN can perform that transition,
-and must provide `CASH`, `UPI`, or `CARD`. The server generates `paidAt` and
-`paidById`; payment update and audit insertion are atomic. No online gateway is
-used.
+Payment is counter-only and independent of the order's operational status
+(`RECEIVED`/`CONFIRMED`/`PREPARING`/`READY`/`COMPLETED`) — an order does not
+need to reach any particular step to be paid: `UNPAID -> PAID`. The one
+exception is `CANCELLED`, which is never payable. Only an authenticated
+branch ADMIN can perform the payment transition, and must provide `CASH`,
+`UPI`, or `CARD`. The server generates `paidAt` and `paidById`; payment
+update and audit insertion are atomic, and a conditional update guards
+against a duplicate or racing payment attempt on the same order. No online
+gateway is used, and no customer-facing route accepts any payment field —
+every order is created `UNPAID` server-side.
 
 ## QR flow
 


## QR flow

```text
opaque QR token
  -> hash lookup of active table
  -> server-resolved branch/table
  -> short-lived TableSession cookie
  -> branch-scoped menu
  -> server-priced order
```

Regenerating a QR replaces its hash, increments `qrVersion`, and revokes all
sessions for that table. A session is invalid when expired, revoked, attached
to an inactive table, or based on an old QR version. Sessions are not
permanently bound to an IP address.

## Validation and checks

From `backend/`:

```bash
npx prisma validate
npx prisma generate
npm run build
npm test
npm run lint
```

`npm run seed` requires `SEED_ADMIN_EMAIL` and a unique
`SEED_ADMIN_PASSWORD` of at least 12 characters. It never prints the password.

