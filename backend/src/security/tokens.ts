import { createHash, randomBytes } from "crypto";

export function createOpaqueToken(byteLength = 32): string {
  if (byteLength < 32) throw new Error("Opaque security tokens must contain at least 256 bits of randomness");
  return randomBytes(byteLength).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function generateOrderNumber(): string {
  const now = new Date();
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("");
  return `SM-${date}-${randomBytes(3).toString("hex").toUpperCase()}`;
}
