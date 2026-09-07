import { PaymentMethod, PaymentStatus, PrismaClient } from "@prisma/client";
import { AUDIT_ACTIONS, recordAudit } from "./audit.service";

/**
 * Centralized counter-payment logic.
 *
 * Business rule: ShriMelan customers never pay online. Payment happens only
 * at the restaurant counter, recorded after the fact by an authenticated
 * ADMIN. This file is the ONLY place allowed to move `Order.paymentStatus`
 * from `UNPAID` to `PAID` — nothing else should call
 * `prisma.order.update({ data: { paymentStatus: ... } } )` directly.
 *
 * Rules encoded here (see ARCHITECTURE.md "Order and payment state"):
 *   1. Customer/public routes never accept paymentStatus, paymentMethod,
 *      paidAt, or paidById — those fields don't even exist in the public
 *      order-creation schema (see order.routes.ts `createOrderSchema`,
 *      which is `.strict()` and rejects any unrecognized key), and every
 *      order is created hardcoded to `UNPAID` server-side.
 *   2. Only an authenticated ADMIN (enforced by `requireAdmin` upstream, the
 *      same guard the whole `staffOrderRouter` uses) may call
 *      `markOrderPaid`.
 *   3. The order lookup is branch-scoped to the calling ADMIN's own branch
 *      (`actor.branchId`) — a cross-branch order id resolves to the same
 *      generic 404 as a nonexistent one, so an ADMIN can never mark another
 *      branch's order as paid.
 *   4. Eligibility is validated before any write: the order must currently
 *      be `UNPAID`, and must not be `CANCELLED` — a cancelled order can
 *      never be marked paid, regardless of when it was cancelled.
 *   5. `paymentMethod` must be one of the `PaymentMethod` enum values
 *      (`CASH` | `UPI` | `CARD`); the caller (the route's zod schema) is
 *      responsible for that validation before this function is ever
 *      invoked, and this function's own type signature makes an invalid
 *      value a compile-time error too.
 *   6. Update + audit insertion happen atomically inside one transaction
 *      this function owns.
 *   7. `paymentStatus`, `paymentMethod`, `paidAt`, and `paidById` are all
 *      generated/recorded here — never taken from client input — alongside
 *      an audit log entry.
 *   8. The transition is guarded by a conditional `updateMany`
 *      (`WHERE id = ? AND paymentStatus = 'UNPAID'`), so a duplicate or
 *      racing payment attempt against an order that has already been paid
 *      (by this call or a concurrent one) fails safely instead of silently
 *      double-recording payment.
 */

export class PaymentTransitionError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "PaymentTransitionError";
    this.status = status;
  }
}

export interface PaymentActor {
  /** Staff.id of the authenticated ADMIN performing the transition. */
  staffId: string;
  /** The ADMIN's own branch — the order must belong to this branch. */
  branchId: string;
}

export interface PaymentTransitionResult {
  id: string;
  branchId: string;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  paidAt: Date;
}

/**
 * The single entry point for recording counter payment on an order.
 *
 * - `prisma` must be the shared top-level PrismaClient — this function owns
 *   its own transaction boundary so the update and audit log are always
 *   atomic together.
 * - Throws `PaymentTransitionError` on any failure: 404 (not found / branch
 *   mismatch), 409 (already paid, order cancelled, or a concurrent payment
 *   attempt raced this one). Callers should let it propagate to the route's
 *   error handler, which never leaks internals for non-500 errors.
 */
export async function markOrderPaid(
  prisma: PrismaClient,
  actor: PaymentActor,
  orderId: string,
  paymentMethod: PaymentMethod,
  ipAddress?: string | null,
): Promise<PaymentTransitionResult> {
  return prisma.$transaction(async (tx) => {
    // Branch isolation: the WHERE clause excludes any order that doesn't
    // belong to this ADMIN's branch, so cross-branch and nonexistent orders
    // are indistinguishable to the caller.
    const existing = await tx.order.findFirst({
      where: { id: orderId, branchId: actor.branchId },
      select: { id: true, branchId: true, paymentStatus: true, status: true },
    });
    if (!existing) {
      throw new PaymentTransitionError("Order not found", 404);
    }

    // Eligibility: a cancelled order can never be paid, and an already-paid
    // order can never be paid again through this path.
    if (existing.status === "CANCELLED") {
      throw new PaymentTransitionError("Cannot mark a cancelled order as paid", 409);
    }
    if (existing.paymentStatus !== "UNPAID") {
      throw new PaymentTransitionError("Only unpaid orders can be marked paid", 409);
    }

    const paidAt = new Date();

    // Conditional update guards against a concurrent payment attempt on the
    // same order landing between our read and our write: the WHERE clause
    // only matches if the order is still UNPAID at write time.
    const updateResult = await tx.order.updateMany({
      where: { id: existing.id, paymentStatus: "UNPAID" },
      data: {
        paymentStatus: "PAID",
        paymentMethod,
        paidAt,
        paidById: actor.staffId,
      },
    });
    if (updateResult.count === 0) {
      throw new PaymentTransitionError(
        "Order payment status changed concurrently; refresh and try again",
        409,
      );
    }

    await recordAudit(tx, {
      actorId: actor.staffId,
      action: AUDIT_ACTIONS.PAYMENT_MARKED_PAID,
      targetType: "Order",
      targetId: existing.id,
      branchId: existing.branchId,
      ipAddress: ipAddress ?? null,
      metadata: { paymentMethod },
    });

    return {
      id: existing.id,
      branchId: existing.branchId,
      paymentStatus: "PAID" as PaymentStatus,
      paymentMethod,
      paidAt,
    };
  });
}
