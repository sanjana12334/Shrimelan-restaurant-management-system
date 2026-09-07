import type {
  MenuResponse,
  OrderResponse,
  TableSessionResponse,
  TableSessionStatusResponse,
} from "./types";

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:4000";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      // Every public endpoint here is cookie-authenticated (the table
      // session is an HttpOnly cookie) — credentials must always be sent,
      // and this app never needs to read or set that cookie directly.
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
    const message = (body && typeof body === "object" && "error" in body && typeof body.error === "string")
      ? body.error
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

/** Generates a fresh per-attempt idempotency key. Random + timestamp is
 * plenty of entropy for a client-side retry key; the server is the source
 * of truth for uniqueness (idempotencyScope + idempotencyKey are unique
 * together per table session). */
export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `key-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export const api = {
  /** Exchanges a scanned QR token for a table session cookie. */
  createTableSession(token: string): Promise<TableSessionResponse> {
    return request<TableSessionResponse>("/api/public/table-session", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
  },

  /** Checks whether an existing table session cookie is still valid. */
  getTableSession(): Promise<TableSessionStatusResponse> {
    return request<TableSessionStatusResponse>("/api/public/table-session", {
      method: "GET",
    });
  },

  /** Branch-scoped, customer-safe menu for the current table session. */
  getMenu(): Promise<MenuResponse> {
    return request<MenuResponse>("/api/public/menu", { method: "GET" });
  },

  /** Submits the cart as an order. The server re-validates and re-prices
   * every line — nothing here is trusted for pricing. */
  createOrder(
    body: {
      customerName: string;
      customerPhone: string;
      note?: string;
      lines: {
        itemId: string;
        variantId?: string;
        quantity: number;
        addonIds: string[];
        instructions?: string;
      }[];
    },
    idempotencyKey: string,
  ): Promise<OrderResponse> {
    return request<OrderResponse>("/api/public/orders", {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ ...body, orderType: "DINE_IN" }),
    });
  },

  /** Order tracking. The access token is the sole authorization — the
   * server treats orderNumber alone as insufficient, so a missing/wrong
   * token is a generic 404, indistinguishable from "no such order". */
  getOrder(orderNumber: string, accessToken: string): Promise<OrderResponse> {
    return request<OrderResponse>(`/api/public/orders/${encodeURIComponent(orderNumber)}`, {
      method: "GET",
      headers: { "X-Order-Access-Token": accessToken },
    });
  },
};
