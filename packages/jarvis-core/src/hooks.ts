/**
 * Jarvis Hook Catalog
 *
 * Centralized policy enforcement via OpenClaw hook registration.
 * Expands beyond the single before_tool_call approval hook to cover:
 * - Pre-tool policy (approval gating, capability checks)
 * - Post-tool provenance (audit enrichment, artifact tracking)
 * - Pre-reply guardrails (PII redaction, compliance checks)
 * - Error policy (centralized retry/escalation decisions)
 *
 * See ADR-PLATFORM-KERNEL-BOUNDARY.md and CONVERGENCE-ROADMAP.md (Epic 8).
 */

import {
  BUILT_IN_TOOLS_REQUIRING_HOOK_APPROVAL,
  JOB_APPROVAL_REQUIREMENT,
  JOB_TYPE_NAMES,
} from "@jarvis/shared";

// ─── Types ───────────────────────────────────────────────────────────

export type ApprovalSeverity = "info" | "warning" | "critical";

export type ApprovalGateResult = {
  requireApproval: {
    title: string;
    description: string;
    severity: ApprovalSeverity;
    timeoutMs: number;
    timeoutBehavior: "deny" | "allow";
  };
};

export type ToolCallEvent = {
  toolName: string;
  toolCallId?: string;
  params?: Record<string, unknown>;
  sessionKey?: string;
};

export type ToolResultEvent = {
  toolName: string;
  toolCallId?: string;
  result?: unknown;
  durationMs?: number;
  sessionKey?: string;
};

export type ReplyEvent = {
  content: string;
  sessionKey?: string;
  toolCalls?: Array<{ name: string; result?: unknown }>;
};

export type ErrorEvent = {
  toolName?: string;
  error: Error | string;
  sessionKey?: string;
  retryCount?: number;
};

export type HookRegistration = {
  hookPoint: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic container for heterogeneous hook signatures
  handler: (...args: any[]) => any;
  priority: number;
  description: string;
};

// ─── Pre-Tool Hooks ──────────────────────────────────────────────────

/**
 * Approval gating for built-in OpenClaw tools.
 * This is the existing hook, now part of the unified catalog.
 */
export function createBuiltInApprovalHook() {
  return {
    hookPoint: "before_tool_call" as const,
    priority: 0,
    description: "Approval gating for sensitive built-in tools (exec, apply_patch, browser)",
    handler: (event: ToolCallEvent): ApprovalGateResult | undefined => {
      if (!BUILT_IN_TOOLS_REQUIRING_HOOK_APPROVAL.has(event.toolName)) {
        return undefined;
      }

      return {
        requireApproval: {
          title: `Approve ${event.toolName}`,
          description: `Jarvis requires operator approval before using ${event.toolName}.`,
          severity: event.toolName === "exec" ? "critical" : "warning",
          timeoutMs: 300_000,
          timeoutBehavior: "deny",
        },
      };
    },
  };
}

/**
 * Approval gating for Jarvis domain tools known to trigger mutations.
 * Uses a hard-coded tool name set (not the job approval requirement mapping)
 * as a defense-in-depth complement to the built-in approval hook.
 */
export function createDomainApprovalHook() {
  // Tools that always need approval when the underlying job requires it
  const MUTATING_TOOLS = new Set([
    "email_send",
    "email_draft",   // drafts are less critical but track them
    "crm_move_stage",
    "crm_update_contact",
  ]);

  return {
    hookPoint: "before_tool_call" as const,
    priority: 10,
    description: "Approval gating for Jarvis domain tools that trigger mutating jobs",
    handler: (event: ToolCallEvent): ApprovalGateResult | undefined => {
      if (!MUTATING_TOOLS.has(event.toolName)) {
        return undefined;
      }

      const severity: ApprovalSeverity =
        event.toolName === "email_send" ? "critical" : "warning";

      return {
        requireApproval: {
          title: `Approve ${event.toolName}`,
          description: `Domain policy requires approval for ${event.toolName}.`,
          severity,
          timeoutMs: 600_000,
          timeoutBehavior: "deny",
        },
      };
    },
  };
}

/**
 * Capability boundary enforcement.
 * Prevents tools from being called in contexts where they shouldn't be available
 * (e.g., read-only operator sessions calling mutating tools).
 */
export function createCapabilityBoundaryHook() {
  // Canonical read-only tool set. Mirrors READONLY_TOOL_NAMES from
  // tool-infra.ts plus Jarvis plugin tools that are purely read-only.
  // Keep in sync with the dashboard's READONLY_TOOL_NAMES and the
  // action-classifier's read-only suffix list.
  const READ_ONLY_TOOLS = new Set([
    // Dashboard copilot tools (from tool-infra.ts READONLY_TOOL_NAMES)
    "web_search", "web_fetch", "crm_search", "knowledge_search",
    "system_info", "list_files", "file_read", "file_list",
    "gmail_search", "gmail_read", "agent_status", "browse_page",
    // Jarvis plugin read-only tools
    "jarvis_plan", "jarvis_get_job", "jarvis_list_artifacts",
    "job_status", "job_artifacts",
    "email_search", "email_read", "email_list_threads",
    "crm_list_pipeline",
  ]);

  return {
    hookPoint: "before_tool_call" as const,
    priority: -10,  // Run before approval hooks
    description: "Capability boundary enforcement for read-only vs mutating contexts",
    handler: (event: ToolCallEvent & { context?: { readOnly?: boolean } }) => {
      // If context declares read-only, block mutating tools
      if (event.context?.readOnly && !READ_ONLY_TOOLS.has(event.toolName)) {
        return {
          deny: {
            reason: `Tool ${event.toolName} is not available in read-only context.`,
            code: "CAPABILITY_BOUNDARY",
          },
        };
      }
      return undefined;
    },
  };
}

// ─── Post-Tool Hooks ─────────────────────────────────────────────────

/**
 * Provenance enrichment after tool execution.
 * Records tool usage for audit trail and artifact provenance.
 */
export function createProvenanceHook() {
  return {
    hookPoint: "after_tool_call" as const,
    priority: 0,
    description: "Records tool execution for audit trail and artifact provenance",
    handler: (event: ToolResultEvent) => {
      // Provenance data to be appended to the session/run context
      return {
        provenance: {
          tool_name: event.toolName,
          tool_call_id: event.toolCallId,
          duration_ms: event.durationMs,
          timestamp: new Date().toISOString(),
        },
      };
    },
  };
}

// ─── Pre-Reply Hooks ─────────────────────────────────────────────────

/**
 * Reply guardrails for operator-facing responses.
 * Checks for PII patterns, credential leakage, and compliance issues.
 */
export function createReplyGuardrailHook() {
  // Patterns that should never appear in operator-facing replies
  const SENSITIVE_PATTERNS = [
    /\bsk-[a-zA-Z0-9]{20,}\b/,          // API keys
    /\b[0-9]{4}[- ]?[0-9]{4}[- ]?[0-9]{4}[- ]?[0-9]{4}\b/, // Credit card numbers
    /\bghp_[a-zA-Z0-9]{36}\b/,           // GitHub personal access tokens
    /\bbot[0-9]{8,}:[A-Za-z0-9_-]{35}\b/, // Telegram bot tokens
  ];

  return {
    hookPoint: "before_reply" as const,
    priority: 0,
    description: "Redacts sensitive patterns from operator-facing replies",
    handler: (event: ReplyEvent) => {
      let content = event.content;
      let redacted = false;

      for (const pattern of SENSITIVE_PATTERNS) {
        if (pattern.test(content)) {
          content = content.replace(pattern, "[REDACTED]");
          redacted = true;
        }
      }

      if (redacted) {
        return {
          modifiedContent: content,
          warning: "Sensitive data redacted from reply.",
        };
      }

      return undefined;
    },
  };
}

// ─── Error Hooks ─────────────────────────────────────────────────────

/**
 * Centralized error policy.
 * Decides whether errors should be retried, escalated, or swallowed.
 */
export function createErrorPolicyHook() {
  const RETRYABLE_ERRORS = new Set([
    "ECONNREFUSED",
    "ETIMEDOUT",
    "ENOTFOUND",
    "WORKER_UNAVAILABLE",
  ]);

  const MAX_RETRIES = 3;

  return {
    hookPoint: "on_error" as const,
    priority: 0,
    description: "Centralized error retry and escalation policy",
    handler: (event: ErrorEvent) => {
      const errorMessage =
        event.error instanceof Error ? event.error.message : String(event.error);

      const isRetryable = RETRYABLE_ERRORS.has(
        errorMessage.split(":")[0] ?? "",
      );
      const withinRetryLimit = (event.retryCount ?? 0) < MAX_RETRIES;

      if (isRetryable && withinRetryLimit) {
        return {
          action: "retry" as const,
          backoffMs: 1000 * Math.pow(2, event.retryCount ?? 0),
        };
      }

      return {
        action: "escalate" as const,
        reason: errorMessage,
      };
    },
  };
}

// ─── Hook Catalog ────────────────────────────────────────────────────

/**
 * Returns the complete hook catalog for registration.
 * Each hook is self-describing with hookPoint, priority, and description.
 */
export function getHookCatalog(): HookRegistration[] {
  return [
    createBuiltInApprovalHook(),
    createDomainApprovalHook(),
    createCapabilityBoundaryHook(),
    createProvenanceHook(),
    createReplyGuardrailHook(),
    createErrorPolicyHook(),
  ];
}
