import type { OrderStatus } from "../types";

/**
 * Mirrors backend/src/services/order-state.service.ts ORDER_STATUS_TRANSITIONS.
 * This is UI affordance only — which buttons to show — never a security
 * boundary. The server re-validates and re-reads the current status itself
 * on every transition request regardless of what this table says.
 */
const NEXT_STEPS: Readonly<Record<OrderStatus, readonly { status: OrderStatus; label: string; kind: "primary" | "danger" }[]>> = {
  RECEIVED: [
    { status: "CONFIRMED", label: "Confirm", kind: "primary" },
    { status: "CANCELLED", label: "Cancel", kind: "danger" },
  ],
  CONFIRMED: [
    { status: "PREPARING", label: "Start preparing", kind: "primary" },
    { status: "CANCELLED", label: "Cancel", kind: "danger" },
  ],
  PREPARING: [{ status: "READY", label: "Mark ready", kind: "primary" }],
  READY: [{ status: "COMPLETED", label: "Complete", kind: "primary" }],
  COMPLETED: [],
  CANCELLED: [],
};

export function nextOrderActions(status: OrderStatus) {
  return NEXT_STEPS[status];
}
