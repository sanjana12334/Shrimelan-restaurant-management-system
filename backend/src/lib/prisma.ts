import { PrismaClient } from "@prisma/client";

/**
 * Single shared Prisma client for the whole process. Previously every route
 * file did `new PrismaClient()` independently, which opens a separate
 * connection pool per file and can exhaust DB connections under load. The
 * auth middleware now needs a DB client on (almost) every request to check
 * live admin status, so this was consolidated here.
 */
export const prisma = new PrismaClient();
