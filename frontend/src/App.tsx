import { Route, Routes } from "react-router-dom";
import { SessionProvider } from "./context/SessionContext";
import { CartProvider } from "./context/CartContext";
import { RequireSession } from "./components/RequireSession";
import { Landing } from "./pages/Landing";
import { Menu } from "./pages/Menu";
import { Cart } from "./pages/Cart";
import { OrderTracking } from "./pages/OrderTracking";

export function App() {
  return (
    <SessionProvider>
      <CartProvider>
        <div className="app-shell">
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/order" element={<Landing />} />
            <Route
              path="/menu"
              element={
                <RequireSession>
                  <Menu />
                </RequireSession>
              }
            />
            <Route
              path="/cart"
              element={
                <RequireSession>
                  <Cart />
                </RequireSession>
              }
            />
            <Route path="/order/:orderNumber" element={<OrderTracking />} />
          </Routes>
        </div>
      </CartProvider>
    </SessionProvider>
  );
}
