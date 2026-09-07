import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCart } from "../context/CartContext";
import { api, ApiError, newIdempotencyKey } from "../api";

export function Cart() {
  const cart = useCart();
  const navigate = useNavigate();
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [note, setNote] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);

  const nameValid = customerName.trim().length > 0 && customerName.trim().length <= 80;
  const phoneValid = customerPhone.trim().length >= 8 && customerPhone.trim().length <= 15;
  const canSubmit = cart.lines.length > 0 && nameValid && phoneValid && !submitting;

  async function placeOrder() {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const order = await api.createOrder(
        {
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim(),
          note: note.trim() || undefined,
          lines: cart.lines.map((line) => ({
            itemId: line.itemId,
            variantId: line.variantId,
            quantity: line.quantity,
            addonIds: line.addonIds,
            instructions: line.instructions,
          })),
        },
        idempotencyKey,
      );
      cart.clearCart();
      navigate(`/order/${order.orderNumber}`, { state: order, replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setSubmitError(err.message);
        // A 4xx here means the cart itself needs to change (e.g. an item
        // went unavailable) — a fresh idempotency key is safe and correct
        // once the customer edits and resubmits. A 5xx/network failure
        // should keep the same key so a resubmit is a safe retry, not a
        // duplicate order.
        if (err.status >= 400 && err.status < 500) {
          setIdempotencyKey(newIdempotencyKey());
        }
      } else {
        setSubmitError("Something went wrong placing your order. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <button type="button" className="back-btn" onClick={() => navigate("/menu")} aria-label="Back to menu">
          ←
        </button>
        <h1 className="page-title">Your cart</h1>
      </header>

      <div className="page-body">
        {cart.lines.length === 0 ? (
          <div className="centered-state">
            <span className="empty-cart-icon">🛒</span>
            <h1>Your cart is empty</h1>
            <p>Add something tasty from the menu to get started.</p>
            <button type="button" className="btn btn-primary" onClick={() => navigate("/menu")}>
              Browse the menu
            </button>
          </div>
        ) : (
          <>
            {cart.lines.map((line) => (
              <div className="cart-line" key={line.lineKey}>
                <div className="cart-line-media">
                  <img src={line.itemImageUrl} alt="" />
                </div>
                <div className="cart-line-info">
                  <div className="cart-line-name">{line.itemName}</div>
                  {(line.variantName || line.addonNames.length > 0) && (
                    <div className="cart-line-meta">
                      {[line.variantName, ...line.addonNames].filter(Boolean).join(" · ")}
                    </div>
                  )}
                  {line.instructions && <div className="cart-line-meta">Note: {line.instructions}</div>}
                  <div className="cart-line-bottom">
                    <QuantityInline value={line.quantity} onChange={(q) => cart.updateQuantity(line.lineKey, q)} />
                    <span className="cart-line-price">₹{(line.unitPrice * line.quantity).toFixed(0)}</span>
                  </div>
                  <button type="button" className="remove-link" onClick={() => cart.removeLine(line.lineKey)}>
                    Remove
                  </button>
                </div>
              </div>
            ))}

            <div className="field">
              <label htmlFor="order-note">Note for the kitchen (optional)</label>
              <textarea
                id="order-note"
                rows={2}
                maxLength={300}
                placeholder="e.g. serve everything together"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="customer-name">Your name</label>
              <input
                id="customer-name"
                type="text"
                maxLength={80}
                placeholder="e.g. Priya"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="customer-phone">Phone number</label>
              <input
                id="customer-phone"
                type="tel"
                maxLength={15}
                placeholder="For the staff to reach you"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
              />
              {customerPhone.length > 0 && !phoneValid && <div className="field-error">Enter a valid phone number.</div>}
            </div>

            <div className="summary-card">
              <div className="summary-row">
                <span>Subtotal</span>
                <span>₹{cart.subtotal.toFixed(0)}</span>
              </div>
              <div className="summary-row">
                <span>Tax (estimated)</span>
                <span>₹{cart.estimatedTax.toFixed(0)}</span>
              </div>
              <div className="summary-row total">
                <span>Total</span>
                <span>₹{cart.estimatedTotal.toFixed(0)}</span>
              </div>
            </div>
            <p className="cart-line-meta" style={{ marginTop: 10 }}>
              Pay at the counter after your meal — cash, UPI, or card. No online payment is needed.
            </p>
          </>
        )}
      </div>

      {cart.lines.length > 0 && (
        <div className="sticky-footer">
          {submitError && <div className="banner-error">{submitError}</div>}
          <button type="button" className="btn btn-primary btn-block" disabled={!canSubmit} onClick={placeOrder}>
            {submitting ? "Placing order…" : `Place order · ₹${cart.estimatedTotal.toFixed(0)}`}
          </button>
        </div>
      )}
    </div>
  );
}

function QuantityInline({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="qty-stepper">
      <button type="button" onClick={() => onChange(value - 1)} aria-label="Decrease quantity">
        −
      </button>
      <span className="qty-value">{value}</span>
      <button type="button" onClick={() => onChange(value + 1)} disabled={value >= 20} aria-label="Increase quantity">
        +
      </button>
    </div>
  );
}
