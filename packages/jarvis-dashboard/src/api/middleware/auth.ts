/**
 * Authentication and authorization middleware for the Jarvis dashboard API.
 *
 * Uses Bearer token auth with role-based access control.
 * Token is read from JARVIS_API_TOKEN env var or ~/.jarvis/config.json.
 *
 * Roles:
 *   admin    — full access, can change settings, approve actions, manage plugins
 *   operator — can trigger agents, approve/reject, view everything
 *   viewer   — read-only access to dashboards and status
 */

import type { Request, Response, NextFunction } from "express";
import { Router } from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import type { IncomingHttpHeaders } from "node:http";
import os from "node:os";
import { join } from "node:path";

export type UserRole = "admin" | "operator" | "viewer";

export type AuthenticatedRequest = Request & {
  user?: { role: UserRole; token_prefix: string };
};

type TokenEntry = {
  token: string;
  role: UserRole;
};

/** Load API tokens from config. Supports single token or role-based token map. */
function loadTokens(): TokenEntry[] {
  // Check env first
  const envToken = process.env.JARVIS_API_TOKEN;
  if (envToken) {
    return [{ token: envToken, role: "admin" }];
  }

  // Check config file
  const configPath = join(os.homedir(), ".jarvis", "config.json");
  if (!fs.existsSync(configPath)) return [];

  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;

    // Simple token: api_token: "secret" -> admin role
    if (typeof raw.api_token === "string") {
      return [{ token: raw.api_token, role: "admin" }];
    }

    // Role-based tokens: api_tokens: { admin: "...", operator: "...", viewer: "..." }
    if (raw.api_tokens && typeof raw.api_tokens === "object") {
      const tokens: TokenEntry[] = [];
      const map = raw.api_tokens as Record<string, string>;
      for (const [role, token] of Object.entries(map)) {
        if (isValidRole(role) && typeof token === "string") {
          tokens.push({ token, role });
        }
      }
      return tokens;
    }
  } catch { /* can't read config */ }

  return [];
}

function isValidRole(role: string): role is UserRole {
  return role === "admin" || role === "operator" || role === "viewer";
}

/** Route permission matrix. Maps HTTP method to minimum required role. */
const ROUTE_PERMISSIONS: Record<string, Record<string, UserRole>> = {
  // Settings and plugin management require admin
  "/api/settings": { GET: "viewer", POST: "admin", PATCH: "admin", DELETE: "admin" },
  "/api/plugins": { GET: "viewer", POST: "admin", DELETE: "admin" },
  "/api/godmode": { GET: "operator", POST: "admin" },

  // Approvals: viewing is operator, resolving is operator
  "/api/approvals": { GET: "operator", POST: "operator", PATCH: "operator" },

  // Agent triggers and webhooks require operator
  "/api/webhooks": { POST: "operator" },

  // Starter packs can change the system safety posture and must remain admin-only.
  "/api/packs": { GET: "viewer", POST: "admin" },

  // CRM mutations require operator
  "/api/crm": { GET: "viewer", POST: "operator", PATCH: "operator", DELETE: "admin" },

  // Knowledge mutations require operator
  "/api/knowledge": { GET: "viewer", POST: "operator", PATCH: "operator", DELETE: "admin" },

  // Auth management — admin only
  "/api/auth": { POST: "admin" },

  // Support bundle contains sensitive diagnostics — admin only
  "/api/support": { GET: "admin" },

  // Service management
  "/api/service": { GET: "viewer", POST: "admin" },

  // Backup/restore require admin
  "/api/backup": { GET: "operator", POST: "admin" },

  // Safe mode
  "/api/safemode": { GET: "viewer", POST: "admin" },

  // Repair assessment
  "/api/repair": { GET: "operator", POST: "admin" },

  // Read-only routes
  "/api/agents": { GET: "viewer" },
  "/api/daemon": { GET: "viewer" },
  "/api/runs": { GET: "viewer" },
  "/api/entities": { GET: "viewer" },
  "/api/analytics": { GET: "viewer" },
  // Chat GET is safe to expose to viewers, but POST can reach sensitive
  // read surfaces (host files, Gmail, browser fetches) and must require an
  // authenticated operator even in dev mode.
  "/api/chat": { GET: "viewer", POST: "operator" },
};

const ROLE_HIERARCHY: Record<UserRole, number> = {
  admin: 3,
  operator: 2,
  viewer: 1,
};

function hasPermission(userRole: UserRole, requiredRole: UserRole): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}

/**
 * Resolve the minimum role required for a given route and method.
 * Falls back to "viewer" for GET, "operator" for mutations.
 */
export function getRequiredRole(path: string, method: string): UserRole {
  // Find matching route prefix
  for (const [prefix, perms] of Object.entries(ROUTE_PERMISSIONS)) {
    if (path.startsWith(prefix)) {
      const role = perms[method.toUpperCase()];
      if (role) return role;
    }
  }

  // Default: GET is viewer, everything else is operator
  return method.toUpperCase() === "GET" ? "viewer" : "operator";
}

// ─── Secret Redaction ────────────────────────────────────────────────────

/** Replace any 32+ character hex strings with [REDACTED]. Useful for logs and error output. */
export function redactSecrets(text: string): string {
  return text.replace(/[0-9a-fA-F]{32,}/g, "[REDACTED]");
}

// ─── Rate Limiting ───────────────────────────────────────────────────────

type FailureRecord = { timestamps: number[]; blockedUntil: number };

const failureMap = new Map<string, FailureRecord>();

const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;   // 5 minutes
const RATE_LIMIT_MAX_FAILURES = 10;
const RATE_LIMIT_BLOCK_MS = 15 * 60 * 1000;    // 15 minutes
const PRUNE_INTERVAL_MS = 5 * 60 * 1000;       // prune every 5 minutes

/** Remove stale entries periodically to prevent unbounded memory growth. */
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of failureMap) {
    if (rec.blockedUntil < now) {
      rec.timestamps = rec.timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
      if (rec.timestamps.length === 0) failureMap.delete(ip);
    }
  }
}, PRUNE_INTERVAL_MS).unref();

/**
 * Get client IP for rate limiting. Only trusts X-Forwarded-For when
 * JARVIS_TRUST_PROXY is set (i.e. behind a known reverse proxy).
 * Otherwise uses the socket address directly to prevent spoofing.
 */
function getClientIp(req: Request): string {
  if (process.env.JARVIS_TRUST_PROXY === "true") {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string") return forwarded.split(",")[0]!.trim();
  }
  return req.socket.remoteAddress ?? "unknown";
}

/** Record an auth failure for rate-limiting purposes. */
function recordFailure(ip: string): void {
  const now = Date.now();
  let rec = failureMap.get(ip);
  if (!rec) {
    rec = { timestamps: [], blockedUntil: 0 };
    failureMap.set(ip, rec);
  }
  rec.timestamps.push(now);
  // Trim old timestamps outside the window
  rec.timestamps = rec.timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  if (rec.timestamps.length >= RATE_LIMIT_MAX_FAILURES) {
    rec.blockedUntil = now + RATE_LIMIT_BLOCK_MS;
  }
}

/** Check if an IP is currently blocked. */
function isBlocked(ip: string): boolean {
  const rec = failureMap.get(ip);
  if (!rec) return false;
  if (rec.blockedUntil > Date.now()) return true;
  return false;
}

function loadWebhookSecret(): string | undefined {
  const configPath = join(os.homedir(), ".jarvis", "config.json");
  if (!fs.existsSync(configPath)) {
    return undefined;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
    return typeof raw.webhook_secret === "string" && raw.webhook_secret.trim()
      ? raw.webhook_secret
      : undefined;
  } catch {
    return undefined;
  }
}

export function shouldBypassWebhookBearerAuth(
  path: string,
  method: string,
  headers: IncomingHttpHeaders,
  hasWebhookSecret: boolean,
): boolean {
  if (!hasWebhookSecret) {
    return false;
  }
  if (method.toUpperCase() !== "POST" || !path.startsWith("/api/webhooks")) {
    return false;
  }
  return typeof headers["x-hub-signature-256"] === "string" ||
    typeof headers["x-jarvis-signature"] === "string";
}

// ─── Auth Middleware ─────────────────────────────────────────────────────

/**
 * Auth middleware factory. Returns middleware that:
 * - Skips auth for /api/health and /api/ready (always public)
 * - If no tokens configured, allows all requests (dev mode)
 * - Otherwise requires Bearer token and checks role permissions
 * - Rate-limits IPs with repeated auth failures
 */
export function createAuthMiddleware() {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    // Health and readiness are always public
    if (req.path === "/api/health" || req.path === "/api/ready") {
      next();
      return;
    }

    // Non-API routes (SPA, static assets) don't need auth
    if (!req.path.startsWith("/api/")) {
      next();
      return;
    }

    if (shouldBypassWebhookBearerAuth(req.path, req.method, req.headers, Boolean(loadWebhookSecret()))) {
      next();
      return;
    }

    // Rate-limit check: block IPs with too many failed auth attempts
    const clientIp = getClientIp(req);
    if (isBlocked(clientIp)) {
      res.status(429).json({ error: "Too many failed authentication attempts. Try again later." });
      return;
    }

    const tokens = loadTokens();
    const mode = process.env.JARVIS_MODE ?? "dev";

    // If no tokens configured: fail closed in production, restricted in dev.
    // The default posture must be safe — no open admin fallback.
    if (tokens.length === 0) {
      if (mode === "production") {
        res.status(503).json({
          error: "Production mode requires API tokens. Configure api_token or api_tokens in ~/.jarvis/config.json",
        });
        return;
      }
      // Dev mode without tokens: grant viewer only (read-only).
      // Mutations require configuring real tokens even in dev.
      const requiredRole = getRequiredRole(req.path, req.method);
      if (requiredRole !== "viewer") {
        res.status(403).json({
          error: "No API tokens configured. Dev mode allows read-only access only. Configure api_token in ~/.jarvis/config.json to enable mutations.",
        });
        return;
      }
      req.user = { role: "viewer", token_prefix: "none" };
      next();
      return;
    }

    // Extract Bearer token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      recordFailure(clientIp);
      res.status(401).json({ error: "Missing or invalid Authorization header. Use: Bearer <token>" });
      return;
    }

    const providedToken = authHeader.slice(7);
    const match = tokens.find(t => t.token === providedToken);

    if (!match) {
      recordFailure(clientIp);
      res.status(401).json({ error: "Invalid API token" });
      return;
    }

    // Check role permission for this route + method
    const requiredRole = getRequiredRole(req.path, req.method);
    if (!hasPermission(match.role, requiredRole)) {
      res.status(403).json({
        error: `Insufficient permissions. Required: ${requiredRole}, have: ${match.role}`,
      });
      return;
    }

    req.user = { role: match.role, token_prefix: providedToken.slice(0, 4) };
    next();
  };
}

// ─── Auth Router (token rotation) ────────────────────────────────────────

export const authRouter = Router();

/** POST /api/auth/rotate — Generate a new admin API token. Requires admin role. */
authRouter.post("/rotate", (req: AuthenticatedRequest, res: Response) => {
  if (!req.user || req.user.role !== "admin") {
    res.status(403).json({ error: "Token rotation requires admin role" });
    return;
  }

  const configPath = join(os.homedir(), ".jarvis", "config.json");
  let config: Record<string, unknown> = {};

  try {
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
    }
  } catch {
    res.status(500).json({ error: "Failed to read config file" });
    return;
  }

  const newToken = crypto.randomBytes(32).toString("hex");

  // Replace the simple api_token. If using role-based tokens, replace the admin token.
  if (config.api_tokens && typeof config.api_tokens === "object") {
    (config.api_tokens as Record<string, string>).admin = newToken;
  } else {
    config.api_token = newToken;
  }

  try {
    const configDir = join(os.homedir(), ".jarvis");
    if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
  } catch {
    res.status(500).json({ error: "Failed to write config file" });
    return;
  }

  res.json({ token_prefix: newToken.slice(0, 4) });
});
