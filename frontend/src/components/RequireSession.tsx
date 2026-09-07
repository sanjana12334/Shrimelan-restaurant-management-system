import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useSession } from "../context/SessionContext";

export function RequireSession({ children }: { children: ReactNode }) {
  const { status } = useSession();

  if (status === "checking") {
    return (
      <div className="centered-state">
        <div className="spinner" />
      </div>
    );
  }

  if (status === "unauthenticated") {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
