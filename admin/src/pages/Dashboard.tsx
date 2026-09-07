import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import type { AdminOrder, AdminTable, AuditLogEntry } from "../types";
import { timeAgo } from "../lib/format";

interface DashboardData {
  orders: AdminOrder[];
  tables: AdminTable[];
  logs: AuditLogEntry[];
}

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [ordersRes, tablesRes, logsRes] = await Promise.all([
          api.getOrders("active"),
          api.getTables(),
          api.getAuditLogs(),
        ]);
        if (cancelled) return;
        setData({ orders: ordersRes.orders, tables: tablesRes.tables, logs: logsRes.logs.slice(0, 5) });
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Could not load the dashboard.");
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1>Dashboard</h1>
          </div>
        </div>
        <div className="card empty-state">{error}</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="full-page-loading">
        <div className="spinner" aria-hidden="true" />
      </div>
    );
  }

  const { orders, tables, logs } = data;
  const countByStatus = (status: AdminOrder["status"]) => orders.filter((o) => o.status === status).length;
  const unpaidActive = orders.filter((o) => o.paymentStatus === "UNPAID").length;
  const activeTables = tables.filter((t) => t.active).length;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p>Live overview of the branch right now.</p>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Active orders</div>
          <div className="stat-value">{orders.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Received</div>
          <div className="stat-value">{countByStatus("RECEIVED")}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Preparing</div>
          <div className="stat-value">{countByStatus("PREPARING")}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Ready</div>
          <div className="stat-value">{countByStatus("READY")}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Unpaid (active)</div>
          <div className="stat-value">{unpaidActive}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Tables active</div>
          <div className="stat-value">
            {activeTables} / {tables.length}
          </div>
        </div>
      </div>

      <div className="card">
        <h2 style={{ margin: "0 0 12px", fontSize: 16 }}>Recent activity</h2>
        {logs.length === 0 ? (
          <div className="empty-state">No audit activity yet.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {logs.map((log) => (
              <div
                key={log.id}
                style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13.5 }}
              >
                <span>
                  <strong>{log.actor?.name ?? "System"}</strong> {log.action.toLowerCase().replaceAll("_", " ")}
                  {log.targetType ? ` — ${log.targetType.toLowerCase()}` : ""}
                </span>
                <span className="order-meta">{timeAgo(log.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
