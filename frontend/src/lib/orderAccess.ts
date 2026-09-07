/**
 * Persists the opaque per-order access token the server returns exactly
 * once, at order creation, so the customer can reopen or refresh the
 * tracking page for *their own* order without re-placing it.
 *
 * Security notes:
 * - The server never re-emits this token from GET /orders/:orderNumber, so
 *   this module is the only place the client keeps it.
 * - sessionStorage (not localStorage) is used deliberately: it's scoped to
 *   the current tab and cleared when the tab/browser closes, which matches
 *   a single dine-in visit and avoids leaving a long-lived order-access
 *   secret sitting on a shared/kiosk device indefinitely.
 * - Keyed per orderNumber so one customer's stored token is never sent for
 *   a different order — the orderNumber in the URL and the token used to
 *   fetch it always come from the same stored pair.
 * - Never put the token in the URL (query/hash): URLs end up in browser
 *   history, referrers, and logs, which would defeat the point of using an
 *   unguessable token instead of the order number alone.
 */

const PREFIX = "shrimelan.orderAccess.";

export function saveOrderAccessToken(orderNumber: string, accessToken: string): void {
  try {
    sessionStorage.setItem(PREFIX + orderNumber, accessToken);
  } catch {
    // Storage can throw (private browsing, quota, etc.) — tracking simply
    // won't survive a refresh in that case, which is a degraded experience,
    // not a security issue.
  }
}

export function getOrderAccessToken(orderNumber: string): string | null {
  try {
    return sessionStorage.getItem(PREFIX + orderNumber);
  } catch {
    return null;
  }
}

export function clearOrderAccessToken(orderNumber: string): void {
  try {
    sessionStorage.removeItem(PREFIX + orderNumber);
  } catch {
    // Nothing to do — see above.
  }
}
