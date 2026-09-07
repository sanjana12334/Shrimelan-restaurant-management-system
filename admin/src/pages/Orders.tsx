import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../api";
import type { AdminOrder, OrderStatus } from "../types";
import { formatMoney, statusBadgeClass, timeAgo } from "../lib/format";
import { nextOrderActions } from "../lib/orderState";

type Scope = "active" | "all";

const POLL_MS = 15000;

export function Orders() {
  const [scope, setScope] = useState<Scope>("active");
  const [orders, setOrders] = useState<AdminOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; error?: boolean } | null>(null);

  const load = useCallback(async (nextScope: Scope, opts?: { silent?: boolean }) => {
    if (!opts?.silent) setOrders(null);
    try {
      const res = await api.getOrders(nextScope);
      setOrders(res.orders);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load orders.");
    }
  }, []);

  useEffect(() => {
    void load(scope);
    const interval = setInterval(() => void load(scope, { silent: true }), POLL_MS);
    return () => clearInterval(interval);
  }, [scope, load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  async function handleStatusChange(order: AdminOrder, status: OrderStatus) {
    setPendingId(order.id);
    try {
      await api.setOrderStatus(order.id, status);
      await load(scope, { silent: true });
      setToast({ message: `Order ${order.orderNumber} → ${status.toLowerCase()}` });
    } catch (err) {
      setToast({ message: err instanceof ApiError ? err.message : "Could not update order.", error: true });
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Orders</h1>
          <p>Live queue, refreshes automatically every 15s.</p>
        </div>
        <div className="tab-pills">
          <button className={scope === "active" ? "active" : ""} onClick={() => setScope("active")}>
            Active
          </button>
          <button className={scope === "all" ? "active" : ""} onClick={() => setScope("all")}>
            All
          </button>
        </div>
      </div>

      {error && <div className="card empty-state">{error}</div>}

      {!error && !orders && (
        <div className="full-page-loading" style={{ height: "40vh" }}>
          <div className="spinner" aria-hidden="true" />
        </div>
      )}

      {!error && orders && orders.length === 0 && (
        <div className="card empty-state">No {scope === "active" ? "active" : ""} orders right now.</div>
      )}

      {!error && orders && orders.length > 0 && (
        <div className="order-grid">
          {orders.map((order) => (
            <div key={order.id} className="order-card">
              <div className="order-card-head">
                <div>
                  <div className="order-number">#{order.orderNumber}</div>
                  <div className="order-meta">
                    {order.orderType} · {order.orderSource} · {timeAgo(order.createdAt)}
                  </div>
                </div>
                <span className={statusBadgeClass(order.status)}>{order.status}</span>
              </div>

              <div className="order-items">
                {order.items.map((item) => (
                  <div className="item-row" key={item.id}>
                    <span>
                      {item.quantity}× {item.itemNameSnap}
                      {item.variantNameSnap ? ` (${item.variantNameSnap})` : ""}
                    </span>
                    <span>{formatMoney(Number(item.unitPriceSnap) * item.quantity)}</span>
                  </div>
                ))}
              </div>

              <div className="order-card-foot">
                <span className="order-total">{formatMoney(order.total)}</span>
                <span className={statusBadgeClass(order.paymentStatus)}>{order.paymentStatus}</span>
              </div>

              <div className="order-actions">
                {nextOrderActions(order.status).map((action) => (
                  <button
                    key={action.status}
                    className={`btn btn-sm ${action.kind === "danger" ? "btn-danger" : "btn-primary"}`}
                    disabled={pendingId === order.id}
                    onClick={() => void handleStatusChange(order, action.status)}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {toast && <div className={`toast ${toast.error ? "error" : ""}`}>{toast.message}</div>}
    </div>
  );
}
