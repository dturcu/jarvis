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
import fs from "node:fs";
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

  // CRM mutations require operator
  "/api/crm": { GET: "viewer", POST: "operator", PATCH: "operator", DELETE: "admin" },

  // Knowledge mutations require operator
  "/api/knowledge": { GET: "viewer", POST: "operator", PATCH: "operator", DELETE: "admin" },

  // Support bundle contains sensitive diagnostics — admin only
  "/api/support": { GET: "admin" },

  // Service management
  "/api/service": { GET: "viewer", POST: "admin" },

  // Backup/restore require admin
  "/api/backup": { GET: "operator", POST: "admin" },

  // Safe mode
  "/api/safemode": { GET: "viewer", POST: "admin" },

  // Read-only routes
  "/api/agents": { GET: "viewer" },
  "/api/daemon": { GET: "viewer" },
  "/api/runs": { GET: "viewer" },
  "/api/entities": { GET: "viewer" },
  "/api/analytics": { GET: "viewer" },
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
function getRequiredRole(path: string, method: string): UserRole {
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

/**
 * Auth middleware factory. Returns middleware that:
 * - Skips auth for /api/health and /api/ready (always public)
 * - If no tokens configured, allows all requests (dev mode)
 * - Otherwise requires Bearer token and checks role permissions
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

    const tokens = loadTokens();

    // If no tokens configured, allow all (dev mode)
    if (tokens.length === 0) {
      req.user = { role: "admin", token_prefix: "none" };
      next();
      return;
    }

    // Extract Bearer token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing or invalid Authorization header. Use: Bearer <token>" });
      return;
    }

    const providedToken = authHeader.slice(7);
    const match = tokens.find(t => t.token === providedToken);

    if (!match) {
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
