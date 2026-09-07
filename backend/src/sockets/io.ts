import { Server as IOServer, type Socket } from "socket.io";
import type { Server as HTTPServer } from "http";
import { prisma } from "../lib/prisma";
import { getConfig } from "../config/env";
import { verifyAdminSessionToken } from "../middleware/auth";
import { extractSessionToken } from "../lib/session-cookie";

let io: IOServer | null = null;
let revalidationTimer: ReturnType<typeof setInterval> | null = null;

// How often live connections are re-checked against the database so a
// logout, deactivation, or forced session-revoke (sessionVersion bump)
// can't leave a stale socket connected indefinitely.
const REVALIDATION_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Identity attached to `socket.data` once a connection has been verified.
 * branchId here is always the DB-verified branch — a client can never
 * influence it, at connect time or afterwards.
 */
interface AdminSocketData {
  staffId: string;
  sessionId: string;
  branchId: string;
  sessionVersion: number;
}

function isAdminSocketData(value: unknown): value is AdminSocketData {
  const data = value as Partial<AdminSocketData> | undefined;
  return (
    typeof data?.staffId === "string" &&
    typeof data?.sessionId === "string" &&
    typeof data?.branchId === "string" &&
    typeof data?.sessionVersion === "number"
  );
}

/** Call once from server.ts after creating the HTTP server. */
export function initIO(httpServer: HTTPServer) {
  io = new IOServer(httpServer, {
    cors: { origin: getConfig().corsOrigins, credentials: true },
  });

  // Admin sockets authenticate with the same HttpOnly cookie/JWT used by the
  // REST API, re-verified against the DB via verifyAdminSessionToken() — the
  // exact same check the HTTP middleware uses, so the two transports can
  // never accept a session the other would reject. branchId always comes
  // from that DB-verified identity; a client-supplied branchId is never
  // read or trusted anywhere in this module.
  io.use(async (socket, next) => {
    try {
      const config = getConfig();
      const token = extractSessionToken(socket.handshake.headers.cookie, config.cookieName);
      const verified = await verifyAdminSessionToken(token);
      if (!verified) return next(new Error("unauthenticated"));

      const data: AdminSocketData = {
        staffId: verified.staffId,
        sessionId: verified.sessionId,
        branchId: verified.branchId,
        sessionVersion: verified.sessionVersion,
      };
      socket.data = data;
      next();
    } catch {
      // Never leak internal error detail (DB errors, stack traces, etc.)
      // to a connecting client — always the same generic rejection.
      next(new Error("unauthenticated"));
    }
  });

  io.on("connection", (socket: Socket) => {
    if (!isAdminSocketData(socket.data)) {
      // Defensive: should be unreachable given the io.use() gate above.
      socket.disconnect(true);
      return;
    }

    // An admin socket may only ever join the single branch room its
    // DB-verified identity belongs to. There is no event that lets a
    // client request another branch or another room.
    socket.join(`branch:${socket.data.branchId}`);

    // This server is broadcast-only infrastructure: privileged mutations
    // (order status, payments, menu, tables, staff, branches) live only in
    // authenticated REST routes. No client-emitted event is ever acted on
    // here — inbound events are explicitly ignored rather than handled, so
    // there is no code path for a client (admin or otherwise) to trigger a
    // mutation over this socket.
    socket.onAny(() => {
      /* intentionally ignored */
    });

    socket.on("error", () => {
      // Swallow transport-level errors; never surface internals to the client.
    });
  });

  if (revalidationTimer) clearInterval(revalidationTimer);
  revalidationTimer = setInterval(() => {
    void revalidateConnectedSockets();
  }, REVALIDATION_INTERVAL_MS);
  revalidationTimer.unref?.();

  return io;
}

/**
 * Re-checks every currently connected socket's identity against the
 * database and disconnects any that are no longer valid: account
 * deactivated, session revoked/expired, sessionVersion bumped (forced
 * logout), or branch reassigned. A socket authenticated at connect time
 * must not be able to outlive the session it was authenticated with.
 */
async function revalidateConnectedSockets(): Promise<void> {
  if (!io) return;
  let sockets: Awaited<ReturnType<IOServer["fetchSockets"]>>;
  try {
    sockets = await io.fetchSockets();
  } catch {
    return;
  }

  await Promise.all(
    sockets.map(async (socket) => {
      if (!isAdminSocketData(socket.data)) {
        socket.disconnect(true);
        return;
      }
      const stillValid = await isSessionStillValid(socket.data);
      if (!stillValid) socket.disconnect(true);
    }),
  );
}

async function isSessionStillValid(data: AdminSocketData): Promise<boolean> {
  try {
    const [staff, session] = await Promise.all([
      prisma.staff.findUnique({
        where: { id: data.staffId },
        select: { active: true, role: true, branchId: true, sessionVersion: true },
      }),
      prisma.adminSession.findFirst({
        where: { id: data.sessionId, staffId: data.staffId, revokedAt: null, expiresAt: { gt: new Date() } },
        select: { id: true },
      }),
    ]);

    return Boolean(
      staff &&
        session &&
        staff.active &&
        staff.role === "ADMIN" &&
        staff.branchId === data.branchId &&
        staff.sessionVersion === data.sessionVersion,
    );
  } catch {
    // Fail closed: a DB error during revalidation disconnects the socket
    // rather than leaving a potentially-stale session connected.
    return false;
  }
}

export function getIO(): IOServer {
  if (!io) throw new Error("Socket.io not initialised — call initIO() first");
  return io;
}
