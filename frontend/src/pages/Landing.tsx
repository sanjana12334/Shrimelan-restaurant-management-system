import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useSession } from "../context/SessionContext";
import { ApiError } from "../api";

export function Landing() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("t");
  const { status, activateFromToken } = useSession();
  const navigate = useNavigate();
  const [scanError, setScanError] = useState<string | null>(null);
  const attempted = useRef(false);

  useEffect(() => {
    if (!token || attempted.current) return;
    attempted.current = true;
    activateFromToken(token)
      .then(() => navigate("/menu", { replace: true }))
      .catch((err: unknown) => {
        const message = err instanceof ApiError ? err.message : "Something went wrong. Please try scanning again.";
        setScanError(message);
      });
  }, [token, activateFromToken, navigate]);

  useEffect(() => {
    if (!token && status === "ready") {
      navigate("/menu", { replace: true });
    }
  }, [token, status, navigate]);

  if (token && !scanError) {
    return (
      <div className="centered-state">
        <div className="spinner" />
        <p>Setting up your table…</p>
      </div>
    );
  }

  if (scanError) {
    return (
      <div className="centered-state">
        <h1>Couldn't open this table</h1>
        <p>{scanError}</p>
        <p>Please scan the QR code on your table again, or ask a staff member for help.</p>
      </div>
    );
  }

  if (!token && status === "checking") {
    return (
      <div className="centered-state">
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div className="centered-state">
      <h1>Welcome to ShriMelan</h1>
      <p>Scan the QR code on your table to view the menu and start your order.</p>
    </div>
  );
}
