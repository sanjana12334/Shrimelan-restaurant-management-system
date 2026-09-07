import { useNavigate } from "react-router-dom";
import { useCart } from "../context/CartContext";

export function CartBar() {
  const { itemCount, estimatedTotal } = useCart();
  const navigate = useNavigate();

  if (itemCount === 0) return null;

  return (
    <button type="button" className="cart-bar" onClick={() => navigate("/cart")}>
      <span className="cart-bar-info">
        <span className="cart-bar-count">
          {itemCount} item{itemCount > 1 ? "s" : ""}
        </span>
        <span className="cart-bar-total">₹{estimatedTotal.toFixed(0)}</span>
      </span>
      <span className="cart-bar-cta">View cart →</span>
    </button>
  );
}
