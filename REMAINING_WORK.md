# ShriMelan Admin — Remaining Work

Status as of this handoff: backend admin API is finished and typechecks
clean. All seven `admin/` page bodies are now implemented (see checklist
below) and `components/StubPage.tsx` has been deleted since nothing
references it anymore. **`npx tsc --noEmit` has not been re-run against
these pages in this sandbox** — this environment has no network access, so
`npm i` in `admin/` can't fetch `node_modules` here (`npm error 403` from
the registry). Run `npm i` then `npx tsc -p admin --noEmit` on a real
machine/CI before shipping; the code was written to match the existing
patterns/types exactly (see "Verify before shipping" below) but hasn't had
a compiler pass.

## How to resume
Paste this file's content (or just say "continue REMAINING_WORK.md") in a
new message and ask Claude to implement the next unchecked item.

## Environment note
`vite build` fails in this sandbox with a `Cannot find native binding
(@rolldown/binding-...)` error — this is pre-existing and reproduces
identically on the untouched `frontend/` app, not something introduced here.
Run `npm i` fresh (removing `node_modules`/`package-lock.json` first) on a
real machine/CI to get a working native binding, then `npm run build` in
both `frontend/` and `admin/`. `tsc --noEmit` (the actual type-correctness
check) passes cleanly right now for both `admin/` and `backend/`.

## Backend — done, no further action needed
- [x] `PATCH /api/admin/tables/:id` (label/active, revokes sessions on deactivate)
- [x] `GET /api/admin/audit-logs` (cursor-paginated, branch-scoped)
- [x] `GET /api/admin/staff` (read-only)
- [x] `GET /api/admin/menu` + `PATCH /api/admin/menu/items/:id/availability`
- [x] `GET /api/auth/staff/me`
- [x] `GET /api/staff/orders` trimmed to explicit `select` (no more hash/idempotency leakage) + `?scope=active|all`
- [x] `npx tsc -p backend --noEmit` clean

## Frontend scaffold — done
`admin/` app (Vite + React + TS, port 3001, matches `STAFF_BASE_URL`):
API client (`src/api.ts`), types (`src/types.ts`), `AuthContext` +
`RequireAuth` (cookie-only session check via `GET /api/auth/staff/me`, 401
anywhere drops back to `/login`), `Layout` sidebar nav, `Login` page,
`App.tsx` routing, design system CSS (`index.css`), helpers
(`lib/format.ts`, `lib/orderState.ts`).

## Pages (`src/pages/*.tsx`) — all implemented

1. [x] **Dashboard** (`pages/Dashboard.tsx`)
   - Fetches `api.getOrders("active")` + `api.getTables()` + `api.getAuditLogs()`
     in parallel.
   - Stat cards: active order count, RECEIVED/PREPARING/READY counts,
     unpaid-among-active count, tables active/total.
   - "Recent activity" panel: last 5 audit log entries with `timeAgo`.

2. [x] **Orders** (`pages/Orders.tsx`)
   - Tab pills: Active / All (calls `getOrders("active" | "all")`).
   - Renders with `.order-grid` / `.order-card`.
   - Per card: order number, type/source, `timeAgo(createdAt)`, items
     (`itemNameSnap` + variant + line total via `formatMoney`), order total,
     status badge and payment badge (both `statusBadgeClass`), and action
     buttons from `nextOrderActions(order.status)` wired to
     `api.setOrderStatus`.
   - Polls every 15s (`setInterval`, silent refresh, cleaned up on unmount)
     — socket.io integration is still a stretch-goal, not done.

3. [x] **Payments** (`pages/Payments.tsx`)
   - Fetches `api.getOrders("all")` + `api.getStaff()` once; filters
     client-side into Unpaid (`paymentStatus === "UNPAID" && status !==
     "CANCELLED"`) and Paid (`paymentStatus === "PAID"`) tabs.
   - Unpaid rows have a "Mark paid" button opening a modal to pick
     `CASH | UPI | CARD` → `api.markOrderPaid`.
   - Paid rows show `paidAt` (`formatDateTime`) and `paidById` resolved to a
     name through an id→name map built from `getStaff()`.

4. [x] **Tables** (`pages/Tables.tsx`)
   - Lists via `api.getTables()` in `table.data-table`.
   - "New table" modal → `api.createTable(label)` → one-time `qrUrl` shown
     in a `.qr-link-box` with a Copy button (`navigator.clipboard`) and a
     `window.print()` label view (sidebar/`.no-print` hidden via the
     existing `@media print` rule). No QR barcode image is fabricated —
     the UI says explicitly to paste the link into a POS/printer's QR tool.
   - Row actions: edit label, activate/deactivate toggle, regenerate QR
     (reuses the same one-time-reveal modal and surfaces the backend's
     "previous QR is now invalid" warning verbatim).

5. [x] **Menu** (`pages/Menu.tsx`)
   - `api.getMenu()`, grouped by category, veg/non-veg dot, bestseller
     badge, price (`formatMoney`), availability toggle via
     `api.setItemAvailability`.
   - Page subtitle states create/edit/delete isn't available yet — no UI
     implies otherwise.

6. [x] **Staff** (`pages/Staff.tsx`)
   - `api.getStaff()` → read-only table (name, email, active badge,
     `formatDateTime(lastLoginAt)`). Subtitle notes add/disable needs its
     own credential-issuance design.

7. [x] **Audit Logs** (`pages/AuditLogs.tsx`)
   - `api.getAuditLogs(cursor)` → table (time, actor name or "System",
     action, target type + short id, metadata as compact JSON). "Load
     more" button appends using `nextCursor`, hidden once it's `null`.

- [x] `admin/src/components/StubPage.tsx` deleted (confirmed nothing
  imports it anymore).

## Verify before shipping
This sandbox has no network access, so `npm i` in `admin/` fails
(`npm error 403` against the npm registry) and `tsc`/`vite build` could not
be run here. On a real machine/CI:
- `npm i` (fresh, per the Environment note above) in `admin/`.
- `npx tsc -p admin --noEmit` — the pages were hand-written against the
  exact types in `src/types.ts` and the exact call signatures in
  `src/api.ts`/`src/lib/*.ts` (no new types or helpers were added), and
  manually checked for `verbatimModuleSyntax` (`import type` for
  type-only imports), `noUnusedLocals`/`noUnusedParameters`, and
  `erasableSyntaxOnly`, but this hasn't had a compiler pass yet.
- `npm run build` in `frontend/`, `admin/`, and `backend/`.
- Copy `backend/.env.example` → `backend/.env`, add
  `STAFF_BASE_URL=http://localhost:3001` to `CORS_ORIGIN` alongside the
  customer app's origin so the admin app's cookie-authenticated requests
  pass `requireTrustedOrigin`.
