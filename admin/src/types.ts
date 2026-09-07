/**
 * Shapes returned by the ADMIN API only. These mirror exactly what the
 * backend's admin routes select — nothing more. Decimal fields (price,
 * total, etc.) arrive as strings (Prisma Decimal.toString()), so they're
 * typed `string` and converted with Number(...) only at display time.
 */

export type OrderStatus = "RECEIVED" | "CONFIRMED" | "PREPARING" | "READY" | "COMPLETED" | "CANCELLED";
export type PaymentStatus = "UNPAID" | "PAID";
export type PaymentMethod = "CASH" | "UPI" | "CARD";

export interface AdminOrderItem {
  id: string;
  itemNameSnap: string;
  variantNameSnap: string | null;
  unitPriceSnap: string;
  quantity: number;
  addonsSnap: { name: string; price: number }[] | null;
  instructions: string | null;
}

export interface AdminOrderStatusHistory {
  id: string;
  status: OrderStatus;
  changedAt: string;
  changedById: string | null;
}

export interface AdminOrder {
  id: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  orderType: "DINE_IN" | "PICKUP" | "DELIVERY";
  orderSource: "QR" | "WEBSITE" | "ADMIN";
  tableId: string | null;
  deliveryAddress: string | null;
  deliveryLandmark: string | null;
  subtotal: string;
  tax: string;
  total: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod | null;
  paidAt: string | null;
  paidById: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  items: AdminOrderItem[];
  statusHistory: AdminOrderStatusHistory[];
}

export interface AdminTable {
  id: string;
  label: string;
  active: boolean;
  qrVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface QrIssueResponse {
  table: AdminTable;
  qrUrl: string;
  qrToken: string;
  warning: string;
}

export interface AdminMenuItem {
  id: string;
  itemCode: string;
  name: string;
  description: string;
  price: string;
  isVeg: boolean;
  isBestseller: boolean;
  isAvailable: boolean;
  imageUrl: string;
}

export interface AdminMenuCategory {
  id: string;
  name: string;
  sortOrder: number;
  items: AdminMenuItem[];
}

export interface AdminStaff {
  id: string;
  name: string;
  email: string;
  role: "ADMIN";
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AuditLogEntry {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  actor: { id: string; name: string } | null;
}

export interface StaffMe {
  id: string;
  name: string;
  email: string;
}
