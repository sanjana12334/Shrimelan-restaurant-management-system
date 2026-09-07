/**
 * Shapes returned by the public/customer API only.
 *
 * These intentionally mirror the *exact* fields the backend selects in
 * menu.routes.ts / order.routes.ts — nothing more. If a field isn't listed
 * here, the backend doesn't send it to customers, and the UI must not
 * assume it exists (no supplier data, cost data, stock counts, staff data,
 * or audit data ever reaches this layer).
 *
 * Decimal fields (price, priceDelta, rating, total, etc.) arrive as
 * strings — Prisma's Decimal serializes via toString(), not as a JS
 * number — so every price in this file is typed `string` and converted
 * with Number(...) only at the point of arithmetic/display.
 */

export interface MenuAddon {
  id: string;
  name: string;
  price: string;
}

export interface MenuVariant {
  id: string;
  name: string;
  priceDelta: string;
}

export interface MenuItem {
  id: string;
  itemCode: string;
  name: string;
  description: string;
  price: string;
  isVeg: boolean;
  rating: string;
  imageUrl: string;
  isBestseller: boolean;
  variants: MenuVariant[];
  addons: MenuAddon[];
}

export interface MenuCategory {
  id: string;
  name: string;
  sortOrder: number;
  items: MenuItem[];
}

export interface MenuResponse {
  categories: MenuCategory[];
}

export interface TableSessionResponse {
  ok: true;
  tableLabel: string;
  expiresAt: string;
}

export interface TableSessionStatusResponse {
  ok: true;
  expiresAt: string;
}

/** One line the customer has configured, ready to send as an order line. */
export interface CartLine {
  /** Client-only key so React/localStorage can identify a line uniquely
   *  (itemId + variantId + sorted addonIds aren't enough on their own if
   *  a customer wants two separate lines with different instructions). */
  lineKey: string;
  itemId: string;
  itemName: string;
  itemImageUrl: string;
  isVeg: boolean;
  variantId?: string;
  variantName?: string;
  addonIds: string[];
  addonNames: string[];
  unitPrice: number;
  quantity: number;
  instructions?: string;
}

export interface OrderLineResponse {
  name: string;
  variant: string | null;
  unitPrice: string;
  quantity: number;
  addons: { name: string; price: number }[] | null;
  instructions: string | null;
}

export interface OrderResponse {
  orderNumber: string;
  accessToken?: string;
  status: string;
  paymentStatus: string;
  total: string;
  items: OrderLineResponse[];
  /** ISO timestamps. `paidAt` is null until an ADMIN records counter payment. */
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
  statusHistory: { status: string; changedAt: string }[];
}
