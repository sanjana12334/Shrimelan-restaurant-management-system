import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAdmin } from "../middleware/auth";
import { sanitizeAuditMetadata } from "../services/audit.service";

export const auditLogRouter = Router();

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

interface AuditCursor {
  createdAt: string;
  id: string;
}

function decodeCursor(value: unknown): AuditCursor | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 500) return null;

  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));

    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof (parsed as AuditCursor).id !== "string" ||
      typeof (parsed as AuditCursor).createdAt !== "string" ||
      Number.isNaN(Date.parse((parsed as AuditCursor).createdAt))
    ) {
      return null;
    }

    return parsed as AuditCursor;
  } catch {
    return null;
  }
}

function encodeCursor(log: { id: string; createdAt: Date }): string {
  return Buffer.from(
    JSON.stringify({ id: log.id, createdAt: log.createdAt.toISOString() }),
  ).toString("base64url");
}

function pageSize(value: unknown): number | null {
  if (value === undefined) return DEFAULT_PAGE_SIZE;
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;

  const parsed = Number(value);
  return parsed >= 1 && parsed <= MAX_PAGE_SIZE ? parsed : null;
}

auditLogRouter.use(requireAdmin);

auditLogRouter.get("/audit-logs", async (req, res, next) => {
  const take = pageSize(req.query.limit);

  if (take === null) {
    return res.status(400).json({
      error: `limit must be an integer between 1 and ${MAX_PAGE_SIZE}`,
    });
  }

  const cursor = req.query.cursor === undefined ? undefined : decodeCursor(req.query.cursor);

  if (req.query.cursor !== undefined && !cursor) {
    return res.status(400).json({ error: "Invalid audit-log cursor" });
  }

  try {
    const logs = await prisma.auditLog.findMany({
      where: {
        branchId: req.staff!.branchId,
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: new Date(cursor.createdAt) } },
                { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: take + 1,
      select: {
        id: true,
        action: true,
        targetType: true,
        targetId: true,
        metadata: true,
        createdAt: true,
        staff: { select: { id: true, name: true } },
      },
    });

    const hasMore = logs.length > take;
    const page = hasMore ? logs.slice(0, take) : logs;

    const safeLogs = page.map((log) => {
      const { staff, metadata, ...safeFields } = log;

      return {
        ...safeFields,
        metadata: metadata === null ? null : sanitizeAuditMetadata(metadata),
        actor: staff,
      };
    });

    res.json({
      logs: safeLogs,
      nextCursor: hasMore && page.length > 0 ? encodeCursor(page[page.length - 1]) : null,
    });
  } catch (err) {
    next(err);
  }
});