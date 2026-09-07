import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const NAV_ITEMS = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/orders", label: "Orders" },
  { to: "/payments", label: "Payments" },
  { to: "/tables", label: "Tables" },
  { to: "/menu", label: "Menu" },
  { to: "/staff", label: "Staff" },
  { to: "/audit-logs", label: "Audit Logs" },
];

export function Layout({ children }: { children: ReactNode }) {
  const { staff, logout } = useAuth();

  return (
    <div className="admin-shell">
      <aside className="sidebar">
        <div className="brand">ShriMelan Admin</div>
        <nav>
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => (isActive ? "active" : "")}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="staff-name">{staff?.name ?? "Admin"}</div>
          <button className="btn btn-secondary btn-sm" style={{ width: "100%" }} onClick={() => void logout()}>
            Log out
          </button>
        </div>
      </aside>
      <main className="main-content">{children}</main>
    </div>
  );
}
