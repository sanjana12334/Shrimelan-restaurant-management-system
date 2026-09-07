import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api";
import type { AdminOrder, PaymentMethod } from "../types";
import { formatDateTime, formatMoney, statusBadgeClass } from "../lib/format";

type Tab = "unpaid" | "paid";

const METHODS: PaymentMethod[] = ["CASH", "UPI", "CARD"];

export function Payments() {
  const [orders, setOrders] = useState<AdminOrder[] | null>(null);
  const [staffById, setStaffById] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("unpaid");
  const [modalOrder, setModalOrder] = useState<AdminOrder | null>(null);
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; error?: boolean } | null>(null);

  async function load() {
    try {
      const [ordersRes, staffRes] = await Promise.all([api.getOrders("all"), api.getStaff()]);
      setOrders(ordersRes.orders);
      const map: Record<string, string> = {};
      for (const s of staffRes.staff) map[s.id] = s.name;
      setStaffById(map);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load payments.");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const unpaid = useMemo(
    () => (orders ?? []).filter((o) => o.paymentStatus === "UNPAID" && o.status !== "CANCELLED"),
    [orders],
  );
  const paid = useMemo(() => (orders ?? []).filter((o) => o.paymentStatus === "PAID"), [orders]);

  function openModal(order: AdminOrder) {
    setModalOrder(order);
    setMethod("CASH");
    setModalError(null);
  }

  async function confirmMarkPaid() {
    if (!modalOrder) return;
    setSubmitting(true);
    setModalError(null);
    try {
      await api.markOrderPaid(modalOrder.id, method);
      setModalOrder(null);
      await load();
      setToast({ message: `Order ${modalOrder.orderNumber} marked paid` });
    } catch (err) {
      setModalError(err instanceof ApiError ? err.message : "Could not mark this order paid.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Payments</h1>
          <p>Track and settle order payments.</p>
        </div>
        <div className="tab-pills">
          <button className={tab === "unpaid" ? "active" : ""} onClick={() => setTab("unpaid")}>
            Unpaid
          </button>
          <button className={tab === "paid" ? "active" : ""} onClick={() => setTab("paid")}>
            Paid
          </button>
        </div>
      </div>

      {error && <div className="card empty-state">{error}</div>}

      {!error && !orders && (
        <div className="full-page-loading" style={{ height: "40vh" }}>
          <div className="spinner" aria-hidden="true" />
        </div>
      )}

      {!error && orders && tab === "unpaid" && (
        <table className="data-table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Type</th>
              <th>Total</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {unpaid.length === 0 && (
              <tr>
                <td colSpan={5} className="empty-state">
                  No unpaid orders.
                </td>
              </tr>
            )}
            {unpaid.map((order) => (
              <tr key={order.id}>
                <td>#{order.orderNumber}</td>
                <td>{order.orderType}</td>
                <td>{formatMoney(order.total)}</td>
                <td>
                  <span className={statusBadgeClass(order.status)}>{order.status}</span>
                </td>
                <td>
                  <button className="btn btn-sm btn-primary" onClick={() => openModal(order)}>
                    Mark paid
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!error && orders && tab === "paid" && (
        <table className="data-table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Total</th>
              <th>Method</th>
              <th>Paid at</th>
              <th>Marked by</th>
            </tr>
          </thead>
          <tbody>
            {paid.length === 0 && (
              <tr>
                <td colSpan={5} className="empty-state">
                  No paid orders yet.
                </td>
              </tr>
            )}
            {paid.map((order) => (
              <tr key={order.id}>
                <td>#{order.orderNumber}</td>
                <td>{formatMoney(order.total)}</td>
                <td>{order.paymentMethod ?? "—"}</td>
                <td>{formatDateTime(order.paidAt)}</td>
                <td>{order.paidById ? staffById[order.paidById] ?? "—" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {modalOrder && (
        <div className="modal-backdrop" onClick={() => !submitting && setModalOrder(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Mark order #{modalOrder.orderNumber} paid</h2>
            {modalError && <div className="error-banner">{modalError}</div>}
            <div className="field">
              <label htmlFor="method">Payment method</label>
              <select id="method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" disabled={submitting} onClick={() => setModalOrder(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" disabled={submitting} onClick={() => void confirmMarkPaid()}>
                {submitting ? "Saving…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`toast ${toast.error ? "error" : ""}`}>{toast.message}</div>}
    </div>
  );
}
