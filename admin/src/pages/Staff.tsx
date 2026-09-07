import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import type { AdminStaff } from "../types";
import { formatDateTime, statusBadgeClass } from "../lib/format";

export function Staff() {
  const [staff, setStaff] = useState<AdminStaff[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getStaff()
      .then((res) => {
        if (!cancelled) setStaff(res.staff);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load staff.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Staff</h1>
          <p>Read-only for now. Adding or disabling staff needs its own credential-issuance flow.</p>
        </div>
      </div>

      {error && <div className="card empty-state">{error}</div>}

      {!error && !staff && (
        <div className="full-page-loading" style={{ height: "40vh" }}>
          <div className="spinner" aria-hidden="true" />
        </div>
      )}

      {!error && staff && staff.length === 0 && <div className="card empty-state">No staff accounts yet.</div>}

      {!error && staff && staff.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Status</th>
              <th>Last login</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((member) => (
              <tr key={member.id}>
                <td>{member.name}</td>
                <td>{member.email}</td>
                <td>
                  <span className={statusBadgeClass(member.active ? "active" : "inactive")}>
                    {member.active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td>{formatDateTime(member.lastLoginAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
