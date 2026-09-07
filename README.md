# ShriMelan

The repository contains:

1. `shrimelan-preview/`, the existing static customer design reference.
2. `backend/`, the Express + Prisma API foundation.

The backend is now ADMIN-only for staff operations. Customer ordering is guest
ordering through a short-lived secure QR table session. Payment is recorded at
the restaurant counter by an authenticated ADMIN only; no online payment
gateway is integrated.

Read `ARCHITECTURE.md` for the current routes, data model, security boundaries,
QR flow, order state machine, and validation commands.

Copy `backend/.env.example` to a local, untracked `backend/.env` and provide
real values through the environment or workspace secrets tooling. Never commit
`backend/.env`.