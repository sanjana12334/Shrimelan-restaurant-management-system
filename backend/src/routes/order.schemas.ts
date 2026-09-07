import { z } from "zod";

/**
 * The public/customer order-creation body schema.
 *
 * `.strict()` at both the top level and per-line means any unrecognized
 * key — including paymentStatus, paymentMethod, paidAt, or paidById — is
 * rejected outright by `validateBody` (400) rather than silently ignored.
 * Payment is never something a customer request can influence; every order
 * is created UNPAID server-side (see order.routes.ts), and only an
 * authenticated ADMIN can ever change that (see payment.service.ts).
 */
export const createOrderSchema = z.object({
  customerName: z.string().trim().min(1).max(80),
  customerPhone: z.string().trim().min(8).max(15),
  orderType: z.literal("DINE_IN"),
  deliveryAddress: z.never().optional(),
  deliveryLandmark: z.never().optional(),
  note: z.string().trim().max(300).optional(),
  lines: z.array(
    z.object({
      itemId: z.string().uuid(),
      variantId: z.string().uuid().optional(),
      quantity: z.number().int().min(1).max(20),
      addonIds: z.array(z.string().uuid()).max(20).default([]),
      instructions: z.string().trim().max(150).optional(),
    }).strict(),
  ).min(1).max(50),
}).strict();

export type CreateOrderBody = z.infer<typeof createOrderSchema>;
