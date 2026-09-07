import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { clearOrderAccessToken, getOrderAccessToken, saveOrderAccessToken } from "../lib/orderAccess";
import type { OrderResponse } from "../types";

/**
 * Customer order tracking.
 *
 * Security model (see backend ARCHITECTURE.md):
 * - The only thing that authorizes reading this order is the opaque access
 *   token returned once at creation. This page never treats the orderNumber
 *   in the URL as sufficient on its own — every fetch sends the token, and
 *   if this page has no token for this orderNumber it never calls the API
 *   at all, it just shows the same "can't access" state a wrong token would
 *   produce.
 * - The token is read from router state (right after placing an order) or
 *   from sessionStorage (on refresh/reopen), and is never put in the URL.
 * - This page is strictly read-only: status, payment status, total, and
 *   items are always rendered exactly as the server returns them. There is
 *   no control anywhere here that can change any of them.
 * - Updates arrive by polling the same token-gated endpoint used for the
 *   initial load — there is no separate, less-checked path for live
 *   updates that could bypass authorization.
 */

const POLL_INTERVAL_MS = 6000;
const TERMINAL_STATUSES = new Set(["COMPLETED", "CANCELLED"]);

const STATUS_LABELS: Record<string, string> = {
  RECEIVED: "Received by the kitchen",
  CONFIRMED: "Confirmed",
  PREPARING: "Preparing",
  READY: "Ready",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

const STATUS_STEPS = ["RECEIVED", "CONFIRMED", "PREPARING", "READY", "COMPLETED"];

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

function formatTime(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(undefined, {
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function OrderTracking() {
  const { orderNumber } = useParams<{ orderNumber: string }>();
  const location = useLocation();
  const navigate = useNavigate();

  // An order just placed arrives with its access token in router state.
  // Persist it immediately so a refresh or reopening this URL later still
  // works — the token is what authorizes access, not the fact that
  // navigation happened.
  const justPlaced = location.state as OrderResponse | undefined;

  const [order, setOrder] = useState<OrderResponse | undefined>(justPlaced);
  const [accessDenied, setAccessDenied] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!justPlaced);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!orderNumber) return;
    if (justPlaced?.accessToken) {
      saveOrderAccessToken(orderNumber, justPlaced.accessToken);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderNumber]);

  const fetchOrder = useCallback(
    async (opts: { silent: boolean }) => {
      if (!orderNumber) return;
      const token = getOrderAccessToken(orderNumber);
      if (!token) {
        setAccessDenied(true);
        setLoading(false);
        return;
      }
      if (!opts.silent) setLoading(true);
      try {
        const fresh = await api.getOrder(orderNumber, token);
        setOrder(fresh);
        setAccessDenied(false);
        setLoadError(null);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          // Wrong, expired, or otherwise invalid access — treat exactly
          // like "no token at all" rather than surfacing any detail about
          // why. The stored token is no good, so drop it.
          clearOrderAccessToken(orderNumber);
          setAccessDenied(true);
        } else if (!opts.silent) {
          setLoadError("Couldn't load your order right now. Please check your connection.");
        }
        // A silent background poll that fails for a transient reason (e.g.
        // a dropped connection) just keeps showing the last-known state
        // rather than replacing it with an error.
      } finally {
        if (!opts.silent) setLoading(false);
      }
    },
    [orderNumber],
  );

  // Initial load: skip the network round-trip entirely when we already
  // have the just-placed order in hand.
  useEffect(() => {
    if (justPlaced) return;
    void fetchOrder({ silent: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderNumber]);

  // Poll for live updates while the order hasn't reached a terminal state.
  // Paused when the tab isn't visible so a backgrounded tab doesn't spend
  // the rate-limit budget for no reason.
  useEffect(() => {
    if (!orderNumber || accessDenied) return;
    if (order && TERMINAL_STATUSES.has(order.status)) return;

    function scheduleNext() {
      pollTimer.current = setTimeout(async () => {
        if (document.visibilityState === "visible") {
          await fetchOrder({ silent: true });
        }
        scheduleNext();
      }, POLL_INTERVAL_MS);
    }
    scheduleNext();

    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [orderNumber, accessDenied, order?.status, fetchOrder]);

  if (!orderNumber) return null;

  if (accessDenied) {
    return (
      <div className="centered-state">
        <h1>We can't show that order here</h1>
        <p>
          This link may have expired, or this device doesn't have access to order {orderNumber}. If you just placed
          this order, go back to your confirmation screen instead.
        </p>
        <button type="button" className="btn btn-primary" onClick={() => navigate("/menu")}>
          Back to menu
        </button>
      </div>
    );
  }

  if (loading && !order) {
    return (
      <div className="centered-state">
        <div className="spinner" />
      </div>
    );
  }

  if (loadError && !order) {
    return (
      <div className="centered-state">
        <h1>Something went wrong</h1>
        <p>{loadError}</p>
        <button type="button" className="btn btn-primary" onClick={() => void fetchOrder({ silent: false })}>
          Try again
        </button>
      </div>
    );
  }

  if (!order) return null;

  const isPaid = order.paymentStatus === "PAID";
  const isCancelled = order.status === "CANCELLED";
  const activeStepIndex = STATUS_STEPS.indexOf(order.status);

  return (
    <div className="page">
      <div className="page-body" style={{ paddingTop: 40 }}>
        <div className={`confirmation-badge${isCancelled ? " confirmation-badge-cancelled" : ""}`}>
          {isCancelled ? "!" : "✓"}
        </div>
        <p style={{ textAlign: "center", color: "var(--charcoal-soft)", marginBottom: 4 }}>
          {justPlaced ? "Order placed" : "Order status"}
        </p>
        <div className="order-number">{order.orderNumber}</div>
        <div style={{ textAlign: "center", marginTop: 10 }}>
          <span className={`status-pill${isCancelled ? " status-pill-cancelled" : ""}`}>
            {statusLabel(order.status)}
          </span>
        </div>

        {!isCancelled && (
          <ol className="tracking-steps" aria-label="Order progress">
            {STATUS_STEPS.map((step, i) => (
              <li
                key={step}
                className={
                  i < activeStepIndex
                    ? "tracking-step done"
                    : i === activeStepIndex
                      ? "tracking-step current"
                      : "tracking-step"
                }
              >
                {statusLabel(step)}
              </li>
            ))}
          </ol>
        )}

        <div className="summary-card">
          {order.items.map((line, i) => (
            <div className="summary-row" key={i}>
              <span>
                {line.quantity} × {line.name}
                {line.variant ? ` (${line.variant})` : ""}
                {line.addons && line.addons.length > 0 ? ` + ${line.addons.map((a) => a.name).join(", ")}` : ""}
              </span>
              <span>₹{(Number(line.unitPrice) * line.quantity).toFixed(0)}</span>
            </div>
          ))}
          <div className="summary-row total">
            <span>Total</span>
            <span>₹{Number(order.total).toFixed(0)}</span>
          </div>
        </div>

        <div className="payment-card">
          <div className="payment-card-row">
            <span>Payment</span>
            <span className={`payment-pill${isPaid ? " payment-pill-paid" : ""}`}>
              {isPaid ? "Paid at counter" : "Unpaid"}
            </span>
          </div>
          <p className="payment-note">Payment is made at the restaurant counter.</p>
          {isPaid && order.paidAt && <p className="cart-line-meta">Paid at {formatTime(order.paidAt)}</p>}
        </div>

        <div className="order-meta">
          <div>
            <span>Placed</span>
            <span>{formatTime(order.createdAt)}</span>
          </div>
          <div>
            <span>Last updated</span>
            <span>{formatTime(order.updatedAt)}</span>
          </div>
        </div>

        <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 20 }} onClick={() => navigate("/menu")}>
          Order something else
        </button>
      </div>
    </div>
  );
}
