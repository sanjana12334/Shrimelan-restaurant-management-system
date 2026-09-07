import assert from "node:assert/strict";
import test from "node:test";
import { priceCart } from "./pricing.service";

/**
 * Branch-authorization ("IDOR") coverage for priceCart.
 *
 * priceCart is the only place a customer-controlled identifier (itemId,
 * variantId, addonIds — all client-supplied on POST /api/public/orders)
 * is resolved against the database, so it is the customer-facing IDOR
 * surface described in the task: a customer sitting at a table in Branch A
 * must never be able to order (and have priced) a menuItemId that belongs
 * to Branch B, even though nothing else about the request looks malicious.
 *
 * No test previously exercised this cross-branch rejection path — only
 * the happy path is implicitly covered by the order-creation flow. This
 * file uses a minimal fake Prisma client (same pattern as
 * payment.service.test.ts / order-state.service.branch-security.test.ts)
 * to test priceCart in isolation from a live database.
 */

interface FakeMenuItem {
  id: string;
  name: string;
  price: number;
  isAvailable: boolean;
  category: { branchId: string };
  variants: { id: string; name: string; priceDelta: number }[];
  addons: { id: string; name: string; price: number; isActive: boolean }[];
}

function makeFakePrisma(items: FakeMenuItem[]) {
  return {
    menuItem: {
      findUnique: async ({ where }: any) => items.find((item) => item.id === where.id) ?? null,
    },
  } as any;
}

const BRANCH_A_ITEM: FakeMenuItem = {
  id: "item-branch-a",
  name: "Paneer Tikka",
  price: 250,
  isAvailable: true,
  category: { branchId: "branch-a" },
  variants: [{ id: "variant-a", name: "Full", priceDelta: 50 }],
  addons: [{ id: "addon-a", name: "Extra Paneer", price: 30, isActive: true }],
};

const BRANCH_B_ITEM: FakeMenuItem = {
  id: "item-branch-b",
  name: "Butter Naan",
  price: 60,
  isAvailable: true,
  category: { branchId: "branch-b" },
  variants: [],
  addons: [],
};

test("prices an item that belongs to the requesting branch", async () => {
  const prisma = makeFakePrisma([BRANCH_A_ITEM]);
  const result = await priceCart(
    prisma,
    [{ itemId: "item-branch-a", quantity: 2, addonIds: [] }],
    "branch-a",
  );
  assert.equal(result.lines.length, 1);
  assert.equal(result.lines[0].unitPriceSnap, 250);
});

test("a menuItemId belonging to a different branch is rejected — cross-branch IDOR", async () => {
  // A customer holds a valid table session for branch-a but supplies an
  // itemId that actually belongs to branch-b (e.g. guessed/enumerated, or
  // reused from a QR code scanned at a different branch's table).
  const prisma = makeFakePrisma([BRANCH_A_ITEM, BRANCH_B_ITEM]);

  await assert.rejects(
    () => priceCart(prisma, [{ itemId: "item-branch-b", quantity: 1, addonIds: [] }], "branch-a"),
    /not available/,
  );
});

test("a nonexistent menuItemId is rejected with the same message as a cross-branch item — no existence leak", async () => {
  const prisma = makeFakePrisma([BRANCH_A_ITEM]);

  const crossBranchAttempt = priceCart(
    prisma,
    [{ itemId: "item-branch-b", quantity: 1, addonIds: [] }],
    "branch-a",
  );
  const nonexistentAttempt = priceCart(
    prisma,
    [{ itemId: "00000000-0000-0000-0000-000000000000", quantity: 1, addonIds: [] }],
    "branch-a",
  );

  const [crossBranchResult, nonexistentResult] = await Promise.allSettled([
    crossBranchAttempt,
    nonexistentAttempt,
  ]);
  assert.equal(crossBranchResult.status, "rejected");
  assert.equal(nonexistentResult.status, "rejected");
  const crossBranchMessage = (crossBranchResult as PromiseRejectedResult).reason.message;
  const nonexistentMessage = (nonexistentResult as PromiseRejectedResult).reason.message;
  assert.match(crossBranchMessage, /is not available/);
  assert.match(nonexistentMessage, /is not available/);
});

test("an unavailable item in the correct branch is rejected the same way as a cross-branch item", async () => {
  const unavailable: FakeMenuItem = { ...BRANCH_A_ITEM, id: "item-unavailable", isAvailable: false };
  const prisma = makeFakePrisma([unavailable]);

  await assert.rejects(
    () => priceCart(prisma, [{ itemId: "item-unavailable", quantity: 1, addonIds: [] }], "branch-a"),
    /not available/,
  );
});

test("a variantId that doesn't belong to the requested item is rejected even if it belongs to the same branch", async () => {
  const otherItemSameBranch: FakeMenuItem = {
    id: "item-branch-a-2",
    name: "Dal Fry",
    price: 150,
    isAvailable: true,
    category: { branchId: "branch-a" },
    variants: [{ id: "variant-a-2", name: "Half", priceDelta: 0 }],
    addons: [],
  };
  const prisma = makeFakePrisma([BRANCH_A_ITEM, otherItemSameBranch]);

  // variant-a-2 belongs to item-branch-a-2, not item-branch-a.
  await assert.rejects(
    () => priceCart(
      prisma,
      [{ itemId: "item-branch-a", variantId: "variant-a-2", quantity: 1, addonIds: [] }],
      "branch-a",
    ),
    /does not belong to item/,
  );
});

test("an addonId that doesn't belong to the requested item is rejected", async () => {
  const otherItemSameBranch: FakeMenuItem = {
    id: "item-branch-a-2",
    name: "Dal Fry",
    price: 150,
    isAvailable: true,
    category: { branchId: "branch-a" },
    variants: [],
    addons: [{ id: "addon-a-2", name: "Extra Ghee", price: 20, isActive: true }],
  };
  const prisma = makeFakePrisma([BRANCH_A_ITEM, otherItemSameBranch]);

  await assert.rejects(
    () => priceCart(
      prisma,
      [{ itemId: "item-branch-a", quantity: 1, addonIds: ["addon-a-2"] }],
      "branch-a",
    ),
    /Invalid or inactive addon/,
  );
});

test("prices multiple lines only when every single line belongs to the requesting branch", async () => {
  const prisma = makeFakePrisma([BRANCH_A_ITEM, BRANCH_B_ITEM]);

  await assert.rejects(
    () => priceCart(
      prisma,
      [
        { itemId: "item-branch-a", quantity: 1, addonIds: [] },
        { itemId: "item-branch-b", quantity: 1, addonIds: [] },
      ],
      "branch-a",
    ),
    /not available/,
  );
});
