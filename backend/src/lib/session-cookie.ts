import { parse as parseCookieHeader } from "cookie";

/**
 * Extracts a named cookie's value from a raw `Cookie` header using the
 * well-tested `cookie` parser (the same one Express's cookie-parser is
 * built on) instead of hand-rolled regex, which is fragile against
 * malformed headers, cookie values containing regex metacharacters, and
 * subtly wrong boundary matching.
 *
 * Deliberately has no dependency on Prisma/DB/config so it can be unit
 * tested in isolation from the rest of the auth stack.
 */
export function extractSessionToken(cookieHeader: string | undefined, cookieName: string): string | undefined {
  if (!cookieHeader) return undefined;
  try {
    return parseCookieHeader(cookieHeader)[cookieName];
  } catch {
    return undefined;
  }
}
