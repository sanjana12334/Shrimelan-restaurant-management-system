import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { api, ApiError } from "../api";
import type { AdminTable, QrIssueResponse } from "../types";
import { formatDateTime, statusBadgeClass } from "../lib/format";

type Modal =
  | { kind: "create" }
  | { kind: "edit"; table: AdminTable }
  | { kind: "qr"; response: QrIssueResponse };

export function Tables() {
  const [tables, setTables] = useState<AdminTable[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal | null>(null);
  const [label, setLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; error?: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  async function load() {
    try {
      const res = await api.getTables();
      setTables(res.tables);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load tables.");
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

  function openCreate() {
    setLabel("");
    setModalError(null);
    setModal({ kind: "create" });
  }

  function openEdit(table: AdminTable) {
    setLabel(table.label);
    setModalError(null);
    setModal({ kind: "edit", table });
  }

  async function submitCreate() {
    setSubmitting(true);
    setModalError(null);
    try {
      const res = await api.createTable(label.trim());
      setModal({ kind: "qr", response: res });
      await load();
    } catch (err) {
      setModalError(err instanceof ApiError ? err.message : "Could not create the table.");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitEdit(table: AdminTable) {
    setSubmitting(true);
    setModalError(null);
    try {
      await api.updateTable(table.id, { label: label.trim() });
      setModal(null);
      await load();
      setToast({ message: `Table "${label.trim()}" updated` });
    } catch (err) {
      setModalError(err instanceof ApiError ? err.message : "Could not update the table.");
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleActive(table: AdminTable) {
    try {
      await api.updateTable(table.id, { active: !table.active });
      await load();
      setToast({ message: `Table "${table.label}" ${table.active ? "deactivated" : "activated"}` });
    } catch (err) {
      setToast({ message: err instanceof ApiError ? err.message : "Could not update the table.", error: true });
    }
  }

  async function regenerate(table: AdminTable) {
    setSubmitting(true);
    setModalError(null);
    try {
      const res = await api.regenerateQr(table.id);
      setModal({ kind: "qr", response: res });
      await load();
    } catch (err) {
      setModalError(err instanceof ApiError ? err.message : "Could not regenerate the QR code.");
    } finally {
      setSubmitting(false);
    }
  }

  function closeModal() {
    if (submitting) return;
    setModal(null);
    setCopied(false);
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Tables</h1>
          <p>Manage dine-in tables and their QR ordering links.</p>
        </div>
        <button className="btn btn-primary no-print" onClick={openCreate}>
          New table
        </button>
      </div>

      {error && <div className="card empty-state">{error}</div>}

      {!error && !tables && (
        <div className="full-page-loading" style={{ height: "40vh" }}>
          <div className="spinner" aria-hidden="true" />
        </div>
      )}

      {!error && tables && tables.length === 0 && <div className="card empty-state">No tables yet.</div>}

      {!error && tables && tables.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th>Label</th>
              <th>Status</th>
              <th>QR version</th>
              <th>Updated</th>
              <th className="no-print"></th>
            </tr>
          </thead>
          <tbody>
            {tables.map((table) => (
              <tr key={table.id}>
                <td>{table.label}</td>
                <td>
                  <span className={statusBadgeClass(table.active ? "active" : "inactive")}>
                    {table.active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td>v{table.qrVersion}</td>
                <td>{formatDateTime(table.updatedAt)}</td>
                <td className="no-print">
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button className="btn btn-sm btn-secondary" onClick={() => openEdit(table)}>
                      Edit
                    </button>
                    <button className="btn btn-sm btn-secondary" onClick={() => void toggleActive(table)}>
                      {table.active ? "Deactivate" : "Activate"}
                    </button>
                    <button className="btn btn-sm btn-secondary" onClick={() => void regenerate(table)}>
                      Regenerate QR
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {modal?.kind === "create" && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>New table</h2>
            {modalError && <div className="error-banner">{modalError}</div>}
            <div className="field">
              <label htmlFor="new-label">Label</label>
              <input id="new-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. T-12" />
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" disabled={submitting} onClick={closeModal}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={submitting || !label.trim()}
                onClick={() => void submitCreate()}
              >
                {submitting ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.kind === "edit" && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Edit table</h2>
            {modalError && <div className="error-banner">{modalError}</div>}
            <div className="field">
              <label htmlFor="edit-label">Label</label>
              <input id="edit-label" value={label} onChange={(e) => setLabel(e.target.value)} />
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" disabled={submitting} onClick={closeModal}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={submitting || !label.trim()}
                onClick={() => void submitEdit(modal.table)}
              >
                {submitting ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.kind === "qr" && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>QR link for "{modal.response.table.label}"</h2>
            <p style={{ fontSize: 13.5, color: "var(--muted)" }}>{modal.response.warning}</p>
            <div
  style={{
    display: "flex",
    justifyContent: "center",
    padding: 16,
    margin: "16px 0",
    background: "white",
  }}
  aria-label={`Scannable ordering QR code for ${modal.response.table.label}`}
>
  <QRCodeSVG
    value={modal.response.qrUrl}
    size={220}
    level="H"
    includeMargin
    title={`Ordering QR code for ${modal.response.table.label}`}
  />
</div>

<p style={{ fontSize: 13.5 }}>
  Scan this code to open the ordering page for this table.
</p>
            <div className="qr-link-box">{modal.response.qrUrl}</div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => void copyLink(modal.response.qrUrl)}>
                {copied ? "Copied!" : "Copy link"}
              </button>
              <button className="btn btn-secondary" onClick={() => window.print()}>
                Print label
              </button>
              <button className="btn btn-primary" onClick={closeModal}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`toast ${toast.error ? "error" : ""}`}>{toast.message}</div>}
    </div>
  );
}
