/**
 * Execution policies define isolation, timeout, and approval requirements
 * for each worker prefix. Used by the worker registry to enforce boundaries.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type WorkerIsolation = "in_process" | "child_process" | "host_boundary";

export type ExecutionPolicy = {
  prefix: string;
  isolation: WorkerIsolation;
  timeout_seconds: number;
  requires_approval_guard: boolean;
};

// ─── Policy Definitions ─────────────────────────────────────────────────────

export const WORKER_EXECUTION_POLICIES: Record<string, ExecutionPolicy> = {
  inference:    { prefix: "inference",    isolation: "in_process",    timeout_seconds: 120,  requires_approval_guard: false },
  email:        { prefix: "email",        isolation: "in_process",    timeout_seconds: 60,   requires_approval_guard: true },
  document:     { prefix: "document",     isolation: "in_process",    timeout_seconds: 300,  requires_approval_guard: false },
  crm:          { prefix: "crm",          isolation: "in_process",    timeout_seconds: 60,   requires_approval_guard: false },
  web:          { prefix: "web",          isolation: "in_process",    timeout_seconds: 120,  requires_approval_guard: false },
  calendar:     { prefix: "calendar",     isolation: "in_process",    timeout_seconds: 60,   requires_approval_guard: true },
  office:       { prefix: "office",       isolation: "in_process",    timeout_seconds: 120,  requires_approval_guard: false },
  time:         { prefix: "time",         isolation: "in_process",    timeout_seconds: 60,   requires_approval_guard: false },
  drive:        { prefix: "drive",        isolation: "in_process",    timeout_seconds: 120,  requires_approval_guard: false },
  system:       { prefix: "system",       isolation: "in_process",    timeout_seconds: 60,   requires_approval_guard: true },
  files:        { prefix: "files",        isolation: "child_process", timeout_seconds: 120,  requires_approval_guard: true },
  interpreter:  { prefix: "interpreter",  isolation: "child_process", timeout_seconds: 900,  requires_approval_guard: true },
  browser:      { prefix: "browser",      isolation: "child_process", timeout_seconds: 900,  requires_approval_guard: false },
  device:       { prefix: "device",       isolation: "child_process", timeout_seconds: 60,   requires_approval_guard: true },
  voice:        { prefix: "voice",        isolation: "child_process", timeout_seconds: 300,  requires_approval_guard: false },
  security:     { prefix: "security",     isolation: "child_process", timeout_seconds: 120,  requires_approval_guard: true },
  social:       { prefix: "social",       isolation: "child_process", timeout_seconds: 300,  requires_approval_guard: true },
};

// ─── Lookup ─────────────────────────────────────────────────────────────────

/** Get the execution policy for a worker prefix. */
export function getExecutionPolicy(prefix: string): ExecutionPolicy | undefined {
  return WORKER_EXECUTION_POLICIES[prefix];
}
