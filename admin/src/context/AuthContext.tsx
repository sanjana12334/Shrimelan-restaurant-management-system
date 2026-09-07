import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, onUnauthorized } from "../api";
import type { StaffMe } from "../types";

type AuthStatus = "checking" | "authenticated" | "unauthenticated";

interface AuthState {
  status: AuthStatus;
  staff: StaffMe | null;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "checking", staff: null });

  const refresh = useCallback(async () => {
    try {
      const staff = await api.me();
      setState({ status: "authenticated", staff });
    } catch {
      setState({ status: "unauthenticated", staff: null });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    // The backend, not the client clock, decides when a session stops
    // being valid — any 401 anywhere in the app (expiry, logout in
    // another tab, a forced revoke-all, deactivation) drops straight back
    // to the login screen instead of the UI silently pretending it's
    // still authenticated.
    onUnauthorized(() => setState({ status: "unauthenticated", staff: null }));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    await api.login(email, password);
    await refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setState({ status: "unauthenticated", staff: null });
    }
  }, []);

  const value = useMemo(() => ({ ...state, login, logout }), [state, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
