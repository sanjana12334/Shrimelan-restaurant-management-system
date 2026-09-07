# Authentication hardening notes

Staff authentication is ADMIN-only and is backed by bcrypt password hashes,
strong password validation, database-backed per-session revocation, and
account-wide revoke-all support through the session version.

Production startup fails closed for missing or placeholder secrets. Cookies are
HttpOnly, Secure, and SameSite=Lax in production. Stateful browser requests
must come from an explicit configured origin, CORS is allow-listed, and request
logging redacts cookies and authorization headers.