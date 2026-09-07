import type {
  AdminMenuCategory,
  AdminMenuItem,
  AdminOrder,
  AdminStaff,
  AdminTable,
  AuditLogEntry,
  OrderStatus,
  PaymentMethod,
  QrIssueResponse,
  StaffMe,
} from "./types";

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:4000";
export interface MenuItemInput {
  categoryId: string;
  itemCode: string;
  name: string;
  description: string;
  price: number;
  imageUrl: string;
  isVeg: boolean;
  isBestseller: boolean;
  isAvailable: boolean;
}
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * Fired whenever any request comes back 401. The AuthContext listens for
 * this so a session that expires or gets revoked mid-use (logout in
 * another tab, forced revoke-all, deactivation) drops the UI back to the
 * login screen immediately — the UI never decides on its own that a
 * session is valid; it only ever reacts to what the backend says.
 */
type UnauthorizedListener = () => void;
let unauthorizedListener: UnauthorizedListener | null = null;
export function onUnauthorized(listener: UnauthorizedListener) {
  unauthorizedListener = listener;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      // The ADMIN session lives only in an HttpOnly cookie set by the
      // backend — this app never reads, stores, or attaches a token
      // itself (no localStorage/sessionStorage credential of any kind).
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError("Could not reach the server. Check your connection and try again.", 0);
  }

  const text = await res.text();
  const body = text ? safeJsonParse(text) : null;

  if (!res.ok) {
    if (res.status === 401) unauthorizedListener?.();
    const message =
      body && typeof body === "object" && "error" in body && typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : "Something went wrong. Please try again.";
    throw new ApiError(message, res.status);
  }

  return body as T;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const api = {
  // ---- Auth ---------------------------------------------------------------
  login(email: string, password: string): Promise<{ name: string }> {
    return request("/api/auth/staff/login", { method: "POST", body: JSON.stringify({ email, password }) });
  },
  me(): Promise<StaffMe> {
    return request("/api/auth/staff/me", { method: "GET" });
  },
  logout(): Promise<{ ok: true }> {
    return request("/api/auth/staff/logout", { method: "POST" });
  },
  revokeAllSessions(): Promise<{ ok: true }> {
    return request("/api/auth/staff/revoke-all", { method: "POST" });
  },

  // ---- Orders ---------------------------------------------------------------
  /** scope "active": live queue (not COMPLETED/CANCELLED). "all": recent history of every status. */
  getOrders(scope: "active" | "all" = "active"): Promise<{ orders: AdminOrder[] }> {
    return request(`/api/staff/orders?scope=${scope}`, { method: "GET" });
  },
  setOrderStatus(orderId: string, status: OrderStatus): Promise<{ id: string; status: OrderStatus }> {
    return request(`/api/staff/orders/${encodeURIComponent(orderId)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
  },
  markOrderPaid(
    orderId: string,
    paymentMethod: PaymentMethod,
  ): Promise<{ id: string; paymentStatus: string; paymentMethod: string; paidAt: string }> {
    return request(`/api/staff/orders/${encodeURIComponent(orderId)}/mark-paid`, {
      method: "PATCH",
      body: JSON.stringify({ paymentMethod }),
    });
  },

  // ---- Tables ---------------------------------------------------------------
  getTables(): Promise<{ tables: AdminTable[] }> {
    return request("/api/admin/tables", { method: "GET" });
  },
  createTable(label: string): Promise<QrIssueResponse> {
    return request("/api/admin/tables", { method: "POST", body: JSON.stringify({ label }) });
  },
  updateTable(id: string, body: { label?: string; active?: boolean }): Promise<{ table: AdminTable }> {
    return request(`/api/admin/tables/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) });
  },
  regenerateQr(id: string): Promise<QrIssueResponse> {
    return request(`/api/admin/tables/${encodeURIComponent(id)}/qr/regenerate`, { method: "POST" });
  },

  // ---- Menu ---------------------------------------------------------------
  getMenu(): Promise<{ categories: AdminMenuCategory[] }> {
    return request("/api/admin/menu", { method: "GET" });
  },
  setItemAvailability(itemId: string, isAvailable: boolean): Promise<{ item: { id: string; isAvailable: boolean } }> {
    return request(`/api/admin/menu/items/${encodeURIComponent(itemId)}/availability`, {
      method: "PATCH",
      body: JSON.stringify({ isAvailable }),
    });
  },
  createMenuItem(input: MenuItemInput): Promise<{ item: AdminMenuItem }> {
    return request("/api/admin/menu/items", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  updateMenuItem(id: string, input: MenuItemInput): Promise<{ item: AdminMenuItem }> {
    return request(`/api/admin/menu/items/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  },

  deleteMenuItem(id: string): Promise<void> {
    return request(`/api/admin/menu/items/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },
  // ---- Staff ---------------------------------------------------------------
  getStaff(): Promise<{ staff: AdminStaff[] }> {
    return request("/api/admin/staff", { method: "GET" });
  },

  // ---- Audit logs -----------------------------------------------------------
  getAuditLogs(cursor?: string): Promise<{ logs: AuditLogEntry[]; nextCursor: string | null }> {
    const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    return request(`/api/admin/audit-logs${qs}`, { method: "GET" });
  },
};
