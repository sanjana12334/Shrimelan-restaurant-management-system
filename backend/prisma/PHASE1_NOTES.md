# Schema migration notes

The migration history in this directory upgrades the original schema to the
current ADMIN-only model, hash-only QR credentials, short-lived table sessions,
server-owned payment fields, order access tokens, and scoped idempotency.

The initial migration retains the original legacy enum definition because
migration history must describe the database that existed before the upgrade.
The current Prisma schema and runtime accept `ADMIN` only.

Before enabling physical table ordering in a real environment, regenerate every
existing table QR. The upgrade can preserve old rows, but regeneration is what
guarantees that every active credential has fresh 256-bit randomness.

Validation commands:

```bash
DATABASE_URL='postgresql://user:pass@host:5432/db?schema=public' npx prisma validate
npx prisma generate
npx prisma migrate deploy
npm run build
npm test
```