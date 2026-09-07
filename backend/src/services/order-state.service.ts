import { OrderStatus, PrismaClient } from "@prisma/client";
import { AUDIT_ACTIONS, recordAudit } from "./audit.service";

/**
 * Centralized ADMIN order state machine.
 *
 * This file is the ONLY place in the codebase allowed to decide whether an
 * order status transition is legal, and `transitionOrderStatus()` below is
 * the ONLY function allowed to actually change `Order.status`. Nothing else
 * — no route, no service, no seed script — should call
 * `prisma.order.update({ data: { status: ... } } )` directly. If a new
 * feature needs to move an order through the flow, it calls
 * `transitionOrderStatus()`.
 *
 * Rules encoded here (see ARCHITECTURE.md "Order and payment state"):
 *   1. Order status is never taken from client input for identity/authority
 *      purposes — callers pass a `targetStatus` the caller has already
 *      validated came from a trusted ADMIN request body, but the *current*
 *      status is always re-read from the database inside this function,
 *      never trusted from the caller.
 *   2. Only an authenticated ADMIN (enforced by `requireAdmin` upstream) may
 *      call this with an `actor`.
 *   3. Every transition is validated against `ORDER_STATUS_TRANSITIONS`
 *      before anything is written.
 *   4. Invalid transitions raise `OrderTransitionError` with a safe,
 *      generic message and an appropriate HTTP status — never a stack
 *      trace or internal detail.
 *   5. A valid transition updates the order, inserts one
 *      `OrderStatusHistory` row, and inserts one `AuditLog` row, all inside
 *      a single database transaction — never any subset of the three.
 *   6. The order lookup is branch-scoped to the calling ADMIN's own branch,
 *      so an ADMIN can never read, let alone transition, another branch's
 *      order — a cross-branch id resolves to the same generic 404 as a
 *      nonexistent one.
 *   7. `COMPLETED` and `CANCELLED` are terminal: neither has any outgoing
 *      transition, so a completed order can never be pushed back to an
 *      earlier state, and a cancelled order can never be revived. If a
 *      future business requirement needs an exception, it must be added
 *      here, explicitly, as a new named transition — never bypassed.
 *   8. The status column is guarded with a conditional `updateMany`
 *      (`WHERE id = ? AND status = ?`) so two concurrent transitions of the
 *      same order can't both apply against a status one of them has
 *      already moved past — the loser gets a safe 409, not a silent
 *      overwrite.
 */

// ---------------------------------------------------------------------------
// Transition table
// ---------------------------------------------------------------------------

/**
 * Normal flow: RECEIVED -> CONFIRMED -> PREPARING -> READY -> COMPLETED.
 * Cancellation is only reachable from RECEIVED or CONFIRMED — once an order
 * is being prepared, staff can no longer cancel it through this endpoint.
 * COMPLETED and CANCELLED are terminal (no outgoing transitions at all).
 */
export const ORDER_STATUS_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = Object.freeze({
  RECEIVED: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PREPARING", "CANCELLED"],
  PREPARING: ["READY"],
  READY: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
});

export function canTransitionOrderStatus(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_STATUS_TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Safe, client-facing error for any order-state-machine failure. `message`
 * is always safe to return verbatim to an authenticated ADMIN caller (it
 * never includes internal identifiers beyond the enum values already in the
 * request, and never a stack trace); the central error handler in
 * server.ts uses `.status` to pick the HTTP code.
 */
export class OrderTransitionError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "OrderTransitionError";
    this.status = status;
  }
}

export function assertOrderStatusTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransitionOrderStatus(from, to)) {
    throw new OrderTransitionError(`Invalid order status transition: ${from} -> ${to}`, 409);
  }
}

// ---------------------------------------------------------------------------
// Centralized transition
// ---------------------------------------------------------------------------

export interface OrderTransitionActor {
  /** Staff.id of the authenticated ADMIN performing the transition. */
  staffId: string;
  /** The ADMIN's own branch — the order must belong to this branch. */
  branchId: string;
}

export interface OrderTransitionResult {
  id: string;
  branchId: string;
  status: OrderStatus;
  previousStatus: OrderStatus;
}

/**
 * The single entry point for changing an order's status.
 *
 * - `prisma` must be the shared top-level PrismaClient (not an existing
 *   `tx`) — this function owns its own transaction boundary so update,
 *   history, and audit are always atomic together.
 * - `actor.branchId` scopes the lookup: an order belonging to a different
 *   branch is indistinguishable from a nonexistent one to the caller.
 * - Throws `OrderTransitionError` (404 not found / branch mismatch, 409
 *   invalid or concurrently-changed transition) on any failure; callers
 *   should let it propagate to the route's error handler.
 */
export async function transitionOrderStatus(
  prisma: PrismaClient,
  actor: OrderTransitionActor,
  orderId: string,
  targetStatus: OrderStatus,
  ipAddress?: string | null,
): Promise<OrderTransitionResult> {
  return prisma.$transaction(async (tx) => {
    // Branch isolation: the WHERE clause itself excludes any order that
    // doesn't belong to this ADMIN's branch, so a cross-branch id and a
    // nonexistent id are handled identically (generic 404, no leak).
    const existing = await tx.order.findFirst({
      where: { id: orderId, branchId: actor.branchId },
      select: { id: true, branchId: true, status: true },
    });
    if (!existing) {
      throw new OrderTransitionError("Order not found", 404);
    }

    // Validate against the current, freshly-read state — never against
    // anything the caller supplied for "current status".
    assertOrderStatusTransition(existing.status, targetStatus);

    // Conditional update guards against a concurrent transition of the same
    // order landing between our read and our write: the WHERE clause only
    // matches if the status is still what we just validated against.
    const updateResult = await tx.order.updateMany({
      where: { id: existing.id, status: existing.status },
      data: { status: targetStatus },
    });
    if (updateResult.count === 0) {
      throw new OrderTransitionError(
        "Order status changed concurrently; refresh and try again",
        409,
      );
    }

    await tx.orderStatusHistory.create({
      data: { orderId: existing.id, status: targetStatus, changedById: actor.staffId },
    });

    await recordAudit(tx, {
      actorId: actor.staffId,
      action: targetStatus === "CANCELLED" ? AUDIT_ACTIONS.ORDER_CANCELLED : AUDIT_ACTIONS.ORDER_STATUS_CHANGED,
      targetType: "Order",
      targetId: existing.id,
      branchId: existing.branchId,
      ipAddress: ipAddress ?? null,
      metadata: { previousStatus: existing.status, newStatus: targetStatus },
    });

    return {
      id: existing.id,
      branchId: existing.branchId,
      status: targetStatus,
      previousStatus: existing.status,
    };
  });
}
