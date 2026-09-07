import { z } from "zod";

/**
 * The public/customer QR-session request body schema.
 *
 * `.strict()` means any unrecognized key — including tableId, branchId, or
 * anything else a client might try to smuggle in to pick a table/branch
 * directly — is rejected outright by `validateBody` (400) rather than
 * silently ignored. The table and branch are always resolved server-side
 * from the `token` value alone (see table-session.service.ts); a customer
 * request can never name a table or branch directly.
 */
export const qrSessionSchema = z.object({
  token: z.string().min(43).max(128),
}).strict();

export type QrSessionBody = z.infer<typeof qrSessionSchema>;
