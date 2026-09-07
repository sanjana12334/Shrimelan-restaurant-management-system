import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import type { AuditLogEntry } from "../types";
import { formatDateTime } from "../lib/format";

export function AuditLogs() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadMore(reset = false) {
    setLoadingMore(true);
    try {
      const res = await api.getAuditLogs(reset ? undefined : (cursor ?? undefined));
      setLogs((prev) => (reset ? res.logs : [...prev, ...res.logs]));
      setCursor(res.nextCursor);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load audit logs.");
    } finally {
      setLoadingMore(false);
      setLoaded(true);
    }
  }

  useEffect(() => {
    void loadMore(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Audit Logs</h1>
          <p>Every admin action, branch-scoped, newest first.</p>
        </div>
      </div>

      {error && <div className="card empty-state">{error}</div>}

      {!error && !loaded && (
        <div className="full-page-loading" style={{ height: "40vh" }}>
          <div className="spinner" aria-hidden="true" />
        </div>
      )}

      {!error && loaded && logs.length === 0 && <div className="card empty-state">No audit activity yet.</div>}

      {!error && loaded && logs.length > 0 && (
        <>
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Target</th>
                <th>Metadata</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td>{formatDateTime(log.createdAt)}</td>
                  <td>{log.actor?.name ?? "System"}</td>
                  <td>{log.action}</td>
                  <td>
                    {log.targetType ?? "—"}
                    {log.targetId ? ` #${log.targetId.slice(0, 8)}` : ""}
                  </td>
                  <td>
                    {log.metadata ? (
                      <code style={{ fontSize: 12 }}>{JSON.stringify(log.metadata)}</code>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {cursor && (
            <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}>
              <button className="btn btn-secondary" disabled={loadingMore} onClick={() => void loadMore()}>
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
