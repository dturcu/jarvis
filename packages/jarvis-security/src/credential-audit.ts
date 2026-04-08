/**
 * Credential Access Audit
 *
 * Wraps credential distribution with audit logging.
 * Closes the trust gap documented in KNOWN-TRUST-GAPS.md:
 * "When getCredentialsForWorker() distributes secrets to workers,
 * this is not recorded in the audit log."
 *
 * See CONVERGENCE-ROADMAP.md Epic 10.
 */

import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

// ─── Types ───────────────────────────────────────────────────────────

export type CredentialAccessEvent = {
  worker_id: string;
  credential_keys: string[];
  run_id?: string;
  job_id?: string;
  granted: boolean;
  reason?: string;
  timestamp: string;
};

export type CredentialAuditConfig = {
  db: DatabaseSync;
  enabled: boolean;
};

// ─── Audit Logger ────────────────────────────────────────────────────

/**
 * Records a credential access event in the audit log.
 *
 * Uses the existing audit_log table in runtime.db with:
 * - actor_type: "worker"
 * - action: "credential.access"
 * - target_type: "credential"
 */
export function logCredentialAccess(
  config: CredentialAuditConfig,
  event: CredentialAccessEvent,
): void {
  if (!config.enabled) return;

  try {
    config.db
      .prepare(
        `INSERT INTO audit_log (audit_id, actor_type, actor_id, action, target_type, target_id, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        "worker",
        event.worker_id,
        event.granted ? "credential.access" : "credential.denied",
        "credential",
        event.credential_keys.join(","),
        JSON.stringify({
          keys: event.credential_keys,
          run_id: event.run_id,
          job_id: event.job_id,
          reason: event.reason,
        }),
        event.timestamp,
      );
  } catch {
    // Best-effort — audit logging failure should not block credential distribution
  }
}

/**
 * Creates an audited version of getCredentialsForWorker.
 *
 * Wraps the original function to log every credential access,
 * providing the audit trail the trust-gap doc identifies as missing.
 *
 * Usage:
 * ```ts
 * const getCreds = createAuditedCredentialAccessor(auditConfig, getCredentialsForWorker);
 * const creds = getCreds("email", config, { runId: "run-123", jobId: "job-456" });
 * ```
 */
export function createAuditedCredentialAccessor<TConfig, TResult>(
  auditConfig: CredentialAuditConfig,
  originalAccessor: (workerId: string, config: TConfig) => TResult,
): (
  workerId: string,
  config: TConfig,
  context?: { runId?: string; jobId?: string },
) => TResult {
  return (
    workerId: string,
    config: TConfig,
    context?: { runId?: string; jobId?: string },
  ): TResult => {
    const result = originalAccessor(workerId, config);

    // Determine which keys were actually distributed
    const distributedKeys =
      result && typeof result === "object"
        ? Object.keys(result as Record<string, unknown>).filter(
            (k) => (result as Record<string, unknown>)[k] !== undefined,
          )
        : [];

    logCredentialAccess(auditConfig, {
      worker_id: workerId,
      credential_keys: distributedKeys,
      run_id: context?.runId,
      job_id: context?.jobId,
      granted: true,
      timestamp: new Date().toISOString(),
    });

    return result;
  };
}

/**
 * Query credential access history for a specific worker or time range.
 * Useful for security audits and incident investigation.
 */
export function queryCredentialAccessLog(
  db: DatabaseSync,
  options: {
    workerId?: string;
    since?: string;
    limit?: number;
  } = {},
): CredentialAccessEvent[] {
  const conditions: string[] = [
    "(action = 'credential.access' OR action = 'credential.denied')",
  ];
  const params: (string | number | null)[] = [];

  if (options.workerId) {
    conditions.push("actor_id = ?");
    params.push(options.workerId);
  }
  if (options.since) {
    conditions.push("created_at >= ?");
    params.push(options.since);
  }

  const limit = options.limit ?? 100;
  params.push(limit);

  const sql = `
    SELECT actor_id, action, target_id, payload_json, created_at
    FROM audit_log
    WHERE ${conditions.join(" AND ")}
    ORDER BY created_at DESC
    LIMIT ?
  `;

  const rows = db.prepare(sql).all(...params) as Array<{
    actor_id: string;
    action: string;
    target_id: string;
    payload_json: string;
    created_at: string;
  }>;

  return rows.map((row) => {
    const payload = JSON.parse(row.payload_json) as {
      keys?: string[];
      run_id?: string;
      job_id?: string;
      reason?: string;
    };
    return {
      worker_id: row.actor_id,
      credential_keys: payload.keys ?? row.target_id.split(","),
      run_id: payload.run_id,
      job_id: payload.job_id,
      granted: row.action === "credential.access",
      reason: payload.reason,
      timestamp: row.created_at,
    };
  });
}
