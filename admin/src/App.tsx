import { Route, Routes } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { RequireAuth } from "./components/RequireAuth";
import { Layout } from "./components/Layout";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { Orders } from "./pages/Orders";
import { Payments } from "./pages/Payments";
import { Tables } from "./pages/Tables";
import { Menu } from "./pages/Menu";
import { Staff } from "./pages/Staff";
import { AuditLogs } from "./pages/AuditLogs";

function Protected({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <Layout>{children}</Layout>
    </RequireAuth>
  );
}

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <Protected>
              <Dashboard />
            </Protected>
          }
        />
        <Route
          path="/orders"
          element={
            <Protected>
              <Orders />
            </Protected>
          }
        />
        <Route
          path="/payments"
          element={
            <Protected>
              <Payments />
            </Protected>
          }
        />
        <Route
          path="/tables"
          element={
            <Protected>
              <Tables />
            </Protected>
          }
        />
        <Route
          path="/menu"
          element={
            <Protected>
              <Menu />
            </Protected>
          }
        />
        <Route
          path="/staff"
          element={
            <Protected>
              <Staff />
            </Protected>
          }
        />
        <Route
          path="/audit-logs"
          element={
            <Protected>
              <AuditLogs />
            </Protected>
          }
        />
      </Routes>
    </AuthProvider>
  );
}
