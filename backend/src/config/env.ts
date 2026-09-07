const PLACEHOLDER_PATTERNS = [
  /replace-with/i,
  /change-this/i,
  /password@host/i,
  /postgres:password/i,
  /default:password/i,
  /^x+$/i,
  /your[-_]/i,
  /<[^>]+>/,
];

function read(name: string, fallback?: string): string | undefined {
  return process.env[name] || fallback;
}

/**
 * Parses a numeric env var, falling back to `fallback` when unset. Throws
 * when the value is set but not a positive integer, so a typo (e.g.
 * RATE_LIMIT_MAX_ORDER_CREATE=abc) fails startup instead of silently
 * becoming NaN — express-rate-limit does not reject a NaN `max`, it simply
 * never throttles, which would silently disable rate limiting in
 * production.
 */
function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Environment variable ${name} must be a positive integer, got: ${raw}`);
  }
  return value;
}

function isPlaceholder(value: string): boolean {
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value));
}

export interface AppConfig {
  nodeEnv: string;
  isProduction: boolean;
  port: number;
  appBaseUrl: string;
  staffBaseUrl: string;
  databaseUrl: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  cookieName: string;
  cookieDomain?: string;
  sessionCookieName: string;
  tableSessionTtlMs: number;
  corsOrigins: string[];
  rateLimitWindowMs: number;
  rateLimitMaxPublic: number;
  rateLimitMaxOrderCreate: number;
  rateLimitMaxTableSession: number;
  rateLimitMaxOrderTracking: number;
  rateLimitMaxAdmin: number;
}

export function validateEnvironment(): void {
  const nodeEnv = process.env.NODE_ENV || "development";
  if (nodeEnv !== "production") return;

  const required = [
    "DATABASE_URL",
    "JWT_SECRET",
    "SESSION_SECRET",
    "APP_BASE_URL",
    "STAFF_BASE_URL",
    "CORS_ORIGIN",
  ];

  for (const name of required) {
    const value = process.env[name];
    if (!value || isPlaceholder(value)) {
      throw new Error(`Missing or placeholder production environment variable: ${name}`);
    }
  }

  const jwtSecret = process.env.JWT_SECRET as string;
  const sessionSecret = process.env.SESSION_SECRET as string;
  if (jwtSecret.length < 64 || sessionSecret.length < 32) {
    throw new Error("Production JWT_SECRET must be at least 64 characters and SESSION_SECRET at least 32 characters");
  }

  for (const name of ["APP_BASE_URL", "STAFF_BASE_URL"]) {
    const url = new URL(process.env[name] as string);
    if (url.protocol !== "https:") {
      throw new Error(`${name} must use HTTPS in production`);
    }
  }

  const origins = process.env.CORS_ORIGIN!.split(",").map((origin) => origin.trim()).filter(Boolean);
  if (origins.length === 0 || origins.includes("*")) {
    throw new Error("CORS_ORIGIN must be a non-empty explicit allow-list in production");
  }
}

export function getConfig(): AppConfig {
  const nodeEnv = process.env.NODE_ENV || "development";
  const appBaseUrl = read("APP_BASE_URL", "http://localhost:3000") as string;
  const staffBaseUrl = read("STAFF_BASE_URL", "http://localhost:3001") as string;
  return {
    nodeEnv,
    isProduction: nodeEnv === "production",
    port: readPositiveInt("PORT", 4000),
    appBaseUrl,
    staffBaseUrl,
    databaseUrl: read("DATABASE_URL", "") as string,
    jwtSecret: read("JWT_SECRET", "") as string,
    jwtExpiresIn: read("JWT_EXPIRES_IN", "8h") as string,
    cookieName: read("COOKIE_NAME", "shrimelan_staff_session") as string,
    cookieDomain: read("COOKIE_DOMAIN"),
    sessionCookieName: read("TABLE_SESSION_COOKIE_NAME", "shrimelan_table_session") as string,
    tableSessionTtlMs: readPositiveInt("TABLE_SESSION_TTL_MS", 2 * 60 * 60 * 1000),
    corsOrigins: (read("CORS_ORIGIN", `${appBaseUrl},${staffBaseUrl}`) as string)
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    rateLimitWindowMs: readPositiveInt("RATE_LIMIT_WINDOW_MS", 60000),
    rateLimitMaxPublic: readPositiveInt("RATE_LIMIT_MAX_PUBLIC", 120),
    rateLimitMaxOrderCreate: readPositiveInt("RATE_LIMIT_MAX_ORDER_CREATE", 10),
    rateLimitMaxTableSession: readPositiveInt("RATE_LIMIT_MAX_TABLE_SESSION", 20),
    rateLimitMaxOrderTracking: readPositiveInt("RATE_LIMIT_MAX_ORDER_TRACKING", 30),
    rateLimitMaxAdmin: readPositiveInt("RATE_LIMIT_MAX_ADMIN", 120),
  };
}

export function allowedOrigins(): string[] {
  return getConfig().corsOrigins;
}
