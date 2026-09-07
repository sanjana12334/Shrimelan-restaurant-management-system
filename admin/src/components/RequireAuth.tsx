import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "../context/AuthContext";

/**
 * Gate for admin-only pages. This is a UX convenience only — it hides
 * pages from an unauthenticated browser tab so the person isn't staring
 * at a page full of failed requests. It is NOT a security boundary: every
 * actual admin route rejects unauthenticated/unauthorized requests on the
 * backend regardless of what this component does or doesn't render.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "checking") {
    return (
      <div className="full-page-loading">
        <div className="spinner" aria-hidden="true" />
      </div>
    );
  }

  if (status === "unauthenticated") {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  return <>{children}</>;
}
