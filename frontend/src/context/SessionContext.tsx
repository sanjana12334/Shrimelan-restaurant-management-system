import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../api";

type SessionStatus = "checking" | "ready" | "unauthenticated";

interface SessionState {
  status: SessionStatus;
  tableLabel: string | null;
  expiresAt: string | null;
}

interface SessionContextValue extends SessionState {
  /** Exchanges a scanned QR token for a session cookie. Throws ApiError on failure. */
  activateFromToken: (token: string) => Promise<void>;
  /** Re-checks whether the existing session cookie (if any) is still valid. */
  refresh: () => Promise<void>;
}

const TABLE_LABEL_KEY = "shrimelan.tableLabel";

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({
    status: "checking",
    tableLabel: sessionStorage.getItem(TABLE_LABEL_KEY),
    expiresAt: null,
  });

  const refresh = useCallback(async () => {
    try {
      const res = await api.getTableSession();
      setState((prev) => ({ ...prev, status: "ready", expiresAt: res.expiresAt }));
    } catch {
      sessionStorage.removeItem(TABLE_LABEL_KEY);
      setState({ status: "unauthenticated", tableLabel: null, expiresAt: null });
    }
  }, []);

  const activateFromToken = useCallback(async (token: string) => {
    // A fresh scan always wins over whatever session (if any) came before —
    // the customer may have moved tables or an old QR may have been
    // revoked, so this never trusts client state, only the server's answer.
    try {
      const res = await api.createTableSession(token);
      sessionStorage.setItem(TABLE_LABEL_KEY, res.tableLabel);
      setState({ status: "ready", tableLabel: res.tableLabel, expiresAt: res.expiresAt });
    } catch (err) {
      sessionStorage.removeItem(TABLE_LABEL_KEY);
      setState({ status: "unauthenticated", tableLabel: null, expiresAt: null });
      throw err;
    }
  }, []);

  useEffect(() => {
    // If the URL carries a fresh QR token, Landing.tsx is responsible for
    // exchanging it via activateFromToken — that request is racing this
    // one, and a stale "no session yet" response arriving after the
    // exchange succeeds would otherwise clobber a just-created session
    // back to unauthenticated. Only self-check for an existing cookie when
    // there's no token to exchange.
    const hasToken = new URLSearchParams(window.location.search).has("t");
    if (!hasToken) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo(
    () => ({ ...state, activateFromToken, refresh }),
    [state, activateFromToken, refresh],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within a SessionProvider");
  return ctx;
}
