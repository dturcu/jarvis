import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { OpenClawPluginToolContext } from "openclaw/plugin-sdk/plugin-entry";
import {
  CONTRACT_VERSION,
  JOB_APPROVAL_REQUIREMENT,
  JOB_TIMEOUT_SECONDS,
  type JarvisApprovalSeverity,
  type JarvisApprovalState,
  type JarvisJobStatus,
  type JarvisJobType,
  type JarvisPriority,
  type JarvisToolStatus
} from "./contracts.js";
import { createToolResponse } from "./results.js";
import type {
  ApprovalRecord,
  ArtifactRef,
  DispatchRecord,
  JobClaim,
  JobClaimRequest,
  JobClaimResult,
  JobEnvelope,
  JobHeartbeatRequest,
  JobHeartbeatResult,
  JobRecord,
  JobResult,
  ToolResponse,
  WorkerCallback
} from "./types.js";

type ApprovalRequest = {
  title: string;
  description: string;
  severity?: JarvisApprovalSeverity;
  scopes?: string[];
};

type SubmitJobParams = {
  ctx?: OpenClawPluginToolContext;
  type: JarvisJobType;
  input: Record<string, unknown>;
  artifactsIn?: ArtifactRef[];
  priority?: JarvisPriority;
  approvalId?: string;
  requestedCommand?: string;
  capabilityRoute?: string;
  notifyOnCompletion?: boolean;
  runGroup?: string;
  attempt?: number;
};

type DispatchParams = {
  kind: DispatchRecord["kind"];
  text: string;
  sessionKey?: string;
  sessionKeys?: string[];
  jobId?: string;
  workerType?: string;
  goal?: string;
  approvalId?: string;
  requireApproval?: boolean;
};

export type JarvisStatePersistenceConfig = {
  filePath?: string;
  databasePath?: string;
  legacySnapshotPath?: string;
};

export type JarvisStateResetOptions = {
  preservePersistence?: boolean;
};

type NormalizedPersistenceConfig = {
  databasePath: string;
  legacySnapshotPath?: string;
};

type JarvisStateSnapshot = {
  contract_version: typeof CONTRACT_VERSION;
  version: 1;
  approvals: ApprovalRecord[];
  jobs: JobRecord[];
  dispatches: DispatchRecord[];
};

const TERMINAL_STATES = new Set<JarvisJobStatus>([
  "completed",
  "failed",
  "cancelled"
]);

function normalizePersistenceConfig(
  config: JarvisStatePersistenceConfig | null | undefined,
): NormalizedPersistenceConfig | null {
  const explicitDatabasePath = config?.databasePath?.trim();
  const legacyOrDatabasePath = config?.filePath?.trim();
  const databaseSource = explicitDatabasePath || legacyOrDatabasePath;

  if (!databaseSource) {
    return null;
  }

  const resolvedSource = resolve(databaseSource);
  const legacySnapshotPath = config?.legacySnapshotPath?.trim()
    ? resolve(config.legacySnapshotPath)
    : undefined;

  if (!explicitDatabasePath && /\.json$/i.test(resolvedSource)) {
    return {
      databasePath: resolvedSource.replace(/\.json$/i, ".sqlite"),
      legacySnapshotPath: legacySnapshotPath ?? resolvedSource
    };
  }

  return {
    databasePath: resolvedSource,
    legacySnapshotPath:
      legacySnapshotPath ??
      resolvedSource.replace(/\.sqlite$/i, ".json")
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSnapshot(filePath: string): JarvisStateSnapshot | null {
  if (!existsSync(filePath)) {
    return null;
  }

  const raw = readFileSync(filePath, "utf8").trim();
  if (!raw) {
    return null;
  }

  const parsed = JSON.parse(raw) as unknown;
  if (
    !isRecord(parsed) ||
    parsed.contract_version !== CONTRACT_VERSION ||
    parsed.version !== 1 ||
    !Array.isArray(parsed.approvals) ||
    !Array.isArray(parsed.jobs) ||
    !Array.isArray(parsed.dispatches)
  ) {
    throw new Error(`Invalid Jarvis state snapshot: ${filePath}`);
  }

  return parsed as JarvisStateSnapshot;
}

function serializeJson(value: unknown): string {
  return JSON.stringify(value);
}

function deserializeJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function nowIso(date = new Date()): string {
  return date.toISOString();
}

function addSeconds(iso: string, seconds: number): string {
  return new Date(Date.parse(iso) + seconds * 1000).toISOString();
}

function resolveCandidateRoutes(request: JobClaimRequest): string[] {
  if (Array.isArray(request.routes) && request.routes.length > 0) {
    return request.routes.map((entry) => entry.trim()).filter(Boolean);
  }

  switch (request.worker_type?.trim()) {
    case "desktop-host":
    case "device":
      return ["device"];
    case "office":
      return ["office"];
    case "python":
      return ["python"];
    case "browser":
      return ["browser"];
    default:
      return [];
  }
}

function isJobClaimable(record: JobRecord, routes: string[], runGroup?: string): boolean {
  if (record.result.status !== "queued") {
    return false;
  }

  if (
    record.envelope.approval_state !== "approved" &&
    record.envelope.approval_state !== "not_required"
  ) {
    return false;
  }

  if (routes.length > 0) {
    const route = record.envelope.type.split(".")[0] ?? "";
    if (!routes.includes(route)) {
      return false;
    }
  }

  const requiredRunGroup =
    typeof record.envelope.metadata.run_group === "string"
      ? record.envelope.metadata.run_group
      : undefined;

  if (requiredRunGroup && runGroup && requiredRunGroup !== runGroup) {
    return false;
  }

  return true;
}

function deriveUpdatedApprovalState(
  type: JarvisJobType,
  approvalGranted: boolean,
): JarvisApprovalState {
  if (approvalGranted) {
    return "approved";
  }
  const requirement = JOB_APPROVAL_REQUIREMENT[type];
  if (requirement === "required" || requirement === "conditional") {
    return "pending";
  }
  return "not_required";
}

class JarvisState {
  private persistenceConfig: NormalizedPersistenceConfig | null = null;
  private db: DatabaseSync;

  constructor(persistenceConfig?: JarvisStatePersistenceConfig | null) {
    this.db = new DatabaseSync(":memory:");
    this.configurePersistence(persistenceConfig ?? null);
  }

  configurePersistence(
    persistenceConfig: JarvisStatePersistenceConfig | null,
  ): void {
    const nextConfig = normalizePersistenceConfig(persistenceConfig);
    this.close();
    this.persistenceConfig = nextConfig;
    this.db = nextConfig
      ? this.openPersistentDatabase(nextConfig)
      : this.openEphemeralDatabase();
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      // Best-effort close only.
    }
  }

  reset(): void {
    this.db.exec(`
      DELETE FROM approvals;
      DELETE FROM jobs;
      DELETE FROM dispatches;
      DELETE FROM metadata WHERE key <> 'schema_version';
    `);
  }

  getStats(): { jobs: number; approvals: number; dispatches: number } {
    return {
      jobs: this.countTable("jobs"),
      approvals: this.countTable("approvals"),
      dispatches: this.countTable("dispatches")
    };
  }

  requestApproval(request: ApprovalRequest): ApprovalRecord {
    const approval_id = randomUUID();
    const record: ApprovalRecord = {
      approval_id,
      state: "pending",
      title: request.title,
      description: request.description,
      severity: request.severity ?? "warning",
      scopes: request.scopes ?? [],
      created_at: nowIso()
    };
    this.writeApprovalRecord(record);
    return record;
  }

  resolveApproval(
    approvalId: string,
    state: Extract<
      JarvisApprovalState,
      "approved" | "rejected" | "expired" | "cancelled"
    >,
    resolvedBy?: string,
  ): ApprovalRecord | null {
    const record = this.getApproval(approvalId);
    if (!record) {
      return null;
    }

    const updated: ApprovalRecord = {
      ...record,
      state,
      resolved_at: nowIso(),
      resolved_by: resolvedBy,
    };
    this.writeApprovalRecord(updated);
    return updated;
  }

  getApproval(approvalId: string): ApprovalRecord | null {
    const row = this.db
      .prepare("SELECT record_json FROM approvals WHERE approval_id = ?")
      .get(approvalId) as { record_json: string } | undefined;
    return row ? deserializeJson<ApprovalRecord>(row.record_json) : null;
  }

  submitJob(params: SubmitJobParams): ToolResponse {
    const approvalRequirement = JOB_APPROVAL_REQUIREMENT[params.type];
    const approvalGranted = this.isApprovalGranted(params.approvalId);

    if (approvalRequirement === "required" && !approvalGranted) {
      const approval = this.requestApproval({
        title: `Approve ${params.type}`,
        description: `Approval required before queuing ${params.type}.`,
        severity: "critical",
        scopes: [params.type]
      });
      return createToolResponse({
        status: "awaiting_approval",
        summary: `Approval required before running ${params.type}.`,
        approval_id: approval.approval_id
      });
    }

    const envelope = this.buildEnvelope(params, approvalGranted);
    const result: JobResult = {
      contract_version: CONTRACT_VERSION,
      job_id: envelope.job_id,
      job_type: envelope.type,
      status: "queued",
      summary: `Queued ${envelope.type}.`,
      attempt: envelope.attempt,
      metrics: {
        queued_at: nowIso(),
        attempt: envelope.attempt
      }
    };

    this.writeJobRecord({
      envelope,
      result,
      claim: null
    });

    return createToolResponse({
      status: "accepted",
      summary: `Queued ${envelope.type}.`,
      job_id: envelope.job_id,
      structured_output: {
        type: envelope.type,
        attempt: envelope.attempt
      }
    });
  }

  getJob(jobId: string): ToolResponse {
    const job = this.getJobRecord(jobId);
    if (!job) {
      return createToolResponse({
        status: "failed",
        summary: `Job ${jobId} was not found.`,
        error: {
          code: "JOB_NOT_FOUND",
          message: `No job found for ${jobId}.`,
          retryable: false
        }
      });
    }

    return createToolResponse({
      status: this.toToolStatus(job.result.status),
      summary: job.result.summary,
      job_id: jobId,
      approval_id: job.result.approval_id,
      artifacts: job.result.artifacts,
      structured_output: {
        envelope: job.envelope,
        result: job.result,
        claim: job.claim ?? null
      },
      error: job.result.error,
      logs: job.result.logs,
      metrics: job.result.metrics
    });
  }

  getJobRecord(jobId: string): JobRecord | null {
    const row = this.db
      .prepare("SELECT record_json FROM jobs WHERE job_id = ?")
      .get(jobId) as { record_json: string } | undefined;
    return row ? deserializeJson<JobRecord>(row.record_json) : null;
  }

  cancelJob(jobId: string, reason?: string): ToolResponse {
    const job = this.getJobRecord(jobId);
    if (!job) {
      return this.getJob(jobId);
    }

    if (TERMINAL_STATES.has(job.result.status)) {
      return createToolResponse({
        status: "failed",
        summary: `Job ${jobId} is already ${job.result.status}.`,
        error: {
          code: "JOB_ALREADY_TERMINAL",
          message: `Cannot cancel a ${job.result.status} job.`,
          retryable: false
        }
      });
    }

    job.claim = null;
    job.result = {
      ...job.result,
      status: "cancelled",
      summary: reason
        ? `Cancelled job ${jobId}: ${reason}`
        : `Cancelled job ${jobId}.`,
      error: {
        code: "CANCELLED",
        message: reason ?? "Cancelled by operator.",
        retryable: false
      },
      metrics: {
        ...job.result.metrics,
        finished_at: nowIso()
      }
    };

    this.writeJobRecord(job);
    return this.getJob(jobId);
  }

  retryJob(jobId: string, approvalId?: string): ToolResponse {
    const job = this.getJobRecord(jobId);
    if (!job) {
      return this.getJob(jobId);
    }

    if (!TERMINAL_STATES.has(job.result.status)) {
      return createToolResponse({
        status: "failed",
        summary: `Job ${jobId} is not in a retryable terminal state.`,
        error: {
          code: "JOB_NOT_RETRYABLE",
          message: "Only completed, failed, or cancelled jobs can be retried.",
          retryable: false
        }
      });
    }

    return this.submitJob({
      type: job.envelope.type,
      input: job.envelope.input,
      artifactsIn: job.envelope.artifacts_in,
      priority: job.envelope.priority,
      approvalId,
      requestedCommand: job.envelope.metadata.requested_command,
      capabilityRoute:
        typeof job.envelope.metadata.capability_route === "string"
          ? job.envelope.metadata.capability_route
          : undefined,
      notifyOnCompletion: job.envelope.metadata.notify_on_completion === true,
      runGroup:
        typeof job.envelope.metadata.run_group === "string"
          ? job.envelope.metadata.run_group
          : undefined,
      attempt: job.envelope.attempt + 1,
      ctx: {
        agentId: job.envelope.metadata.agent_id,
        sessionKey: job.envelope.session_key,
        messageChannel: job.envelope.requested_by.channel,
        requesterSenderId: job.envelope.requested_by.user_id
      }
    });
  }

  listArtifacts(jobId?: string): ToolResponse {
    if (jobId) {
      const job = this.getJobRecord(jobId);
      if (!job) {
        return this.getJob(jobId);
      }
      return createToolResponse({
        status: "completed",
        summary: `Found ${job.result.artifacts?.length ?? 0} artifacts for ${jobId}.`,
        job_id: jobId,
        artifacts: job.result.artifacts ?? []
      });
    }

    const artifacts = this.listJobRecords().flatMap(
      (job) => job.result.artifacts ?? [],
    );

    return createToolResponse({
      status: "completed",
      summary: `Found ${artifacts.length} registered artifacts.`,
      artifacts
    });
  }

  requeueExpiredJobs(): number {
    const now = nowIso();
    const rows = this.db
      .prepare(
        "SELECT record_json FROM jobs WHERE status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at < ?",
      )
      .all(now) as Array<{ record_json: string }>;

    for (const row of rows) {
      const record = deserializeJson<JobRecord>(row.record_json);
      record.claim = null;
      record.result = {
        ...record.result,
        status: "queued",
        summary: `Re-queued ${record.envelope.type} after lease expiry.`,
        metrics: {
          ...record.result.metrics,
          worker_id: undefined,
          started_at: undefined,
          finished_at: undefined
        }
      };
      this.writeJobRecord(record, now);
    }

    return rows.length;
  }

  claimJob(request: JobClaimRequest): JobClaimResult | null {
    const rows = this.db
      .prepare(
        `
          SELECT record_json
          FROM jobs
          WHERE status = 'queued'
          ORDER BY
            CASE priority
              WHEN 'urgent' THEN 0
              WHEN 'high' THEN 1
              WHEN 'normal' THEN 2
              ELSE 3
            END,
            updated_at ASC
        `,
      )
      .all() as Array<{ record_json: string }>;

    const routes = resolveCandidateRoutes(request);

    for (const row of rows) {
      const record = deserializeJson<JobRecord>(row.record_json);
      if (!isJobClaimable(record, routes, request.run_group)) {
        continue;
      }

      const claimedAt = request.requested_at ?? nowIso();
      const leaseSeconds = Math.max(5, Math.floor(request.lease_seconds ?? 60));
      const claim: JobClaim = {
        claim_id: randomUUID(),
        claimed_by: request.worker_id,
        lease_expires_at: addSeconds(claimedAt, leaseSeconds),
        last_heartbeat_at: claimedAt,
        run_group: request.run_group
      };

      record.claim = claim;
      record.result = {
        ...record.result,
        status: "running",
        summary: `Running ${record.envelope.type}.`,
        metrics: {
          ...record.result.metrics,
          started_at: claimedAt,
          finished_at: undefined,
          worker_id: request.worker_id,
          attempt: record.envelope.attempt
        }
      };

      this.writeJobRecord(record, claimedAt);
      return {
        claimed: true,
        job_id: record.envelope.job_id,
        claim_id: claim.claim_id,
        status: "claimed",
        summary: `Claimed ${record.envelope.type}.`,
        lease_expires_at: claim.lease_expires_at,
        attempt: record.envelope.attempt,
        job_type: record.envelope.type,
        job: record.envelope,
        structured_output: {
          claim
        },
        artifacts: record.result.artifacts,
        metrics: record.result.metrics
      };
    }

    return null;
  }

  heartbeatJob(request: JobHeartbeatRequest): JobHeartbeatResult | null {
    const record = this.getJobRecord(request.job_id);
    if (!record?.claim) {
      return null;
    }

    if (
      record.claim.claim_id !== request.claim_id ||
      record.claim.claimed_by !== request.worker_id
    ) {
      return null;
    }

    const heartbeatAt = request.heartbeat_at ?? nowIso();
    const leaseSeconds = Math.max(5, Math.floor(request.lease_seconds ?? 60));
    record.claim = {
      ...record.claim,
      lease_expires_at: addSeconds(heartbeatAt, leaseSeconds),
      last_heartbeat_at: heartbeatAt
    };
    record.result = {
      ...record.result,
      status:
        request.status === "awaiting_approval"
          ? "awaiting_approval"
          : "running",
      summary: request.summary ?? record.result.summary,
      metrics: {
        ...record.result.metrics,
        worker_id: request.worker_id,
        attempt: record.envelope.attempt
      }
    };

    this.writeJobRecord(record, heartbeatAt);

    return {
      acknowledged: true,
      job_id: record.envelope.job_id,
      claim_id: record.claim.claim_id,
      status: record.result.status,
      summary: record.result.summary,
      lease_expires_at: record.claim.lease_expires_at,
      attempt: record.envelope.attempt,
      job_type: record.envelope.type,
      structured_output: {
        claim: record.claim
      },
      artifacts: record.result.artifacts,
      metrics: record.result.metrics
    };
  }

  handleWorkerCallback(callback: WorkerCallback): JobResult {
    const job = this.getJobRecord(callback.job_id);
    if (!job) {
      throw new Error(`Unknown job ${callback.job_id}`);
    }

    if (TERMINAL_STATES.has(job.result.status)) {
      return job.result;
    }

    job.claim = null;
    job.result = {
      contract_version: CONTRACT_VERSION,
      job_id: callback.job_id,
      job_type: callback.job_type,
      status: callback.status,
      summary: callback.summary,
      attempt: callback.attempt,
      approval_id: callback.approval_id,
      artifacts: callback.artifacts ?? job.result.artifacts,
      structured_output: callback.structured_output,
      error: callback.error,
      logs: callback.logs,
      metrics: {
        ...job.result.metrics,
        ...callback.metrics,
        worker_id: callback.worker_id,
        attempt: callback.attempt
      }
    };

    this.writeJobRecord(job);
    return job.result;
  }

  createDispatch(params: DispatchParams): ToolResponse {
    const requireApproval = params.requireApproval !== false;
    if (requireApproval && !this.isApprovalGranted(params.approvalId)) {
      const approval = this.requestApproval({
        title: `Approve ${params.kind}`,
        description: `Approval required before ${params.kind.replaceAll("_", " ")}.`,
        severity: "warning",
        scopes: [params.kind]
      });
      return createToolResponse({
        status: "awaiting_approval",
        summary: `Approval required before ${params.kind}.`,
        approval_id: approval.approval_id
      });
    }

    const dispatch: DispatchRecord = {
      dispatch_id: randomUUID(),
      kind: params.kind,
      text: params.text,
      session_key: params.sessionKey,
      session_keys: params.sessionKeys,
      job_id: params.jobId,
      worker_type: params.workerType,
      goal: params.goal,
      created_at: nowIso(),
      delivery_status: "pending"
    };
    this.writeDispatchRecord(dispatch);

    return createToolResponse({
      status: "accepted",
      summary: `Accepted ${params.kind}.`,
      structured_output: {
        dispatch
      }
    });
  }

  markDispatchDelivered(
    dispatchId: string,
    deliveryReceipt?: Record<string, unknown>,
  ): DispatchRecord | null {
    const dispatch = this.getDispatchRecord(dispatchId);
    if (!dispatch) {
      return null;
    }

    const updated: DispatchRecord = {
      ...dispatch,
      delivery_status: "sent",
      delivery_receipt: deliveryReceipt,
      delivered_at: nowIso(),
      error: undefined
    };
    this.writeDispatchRecord(updated);
    return updated;
  }

  markDispatchFailed(
    dispatchId: string,
    code: string,
    message: string,
    retryable = false,
    details?: Record<string, unknown>,
  ): DispatchRecord | null {
    const dispatch = this.getDispatchRecord(dispatchId);
    if (!dispatch) {
      return null;
    }

    const updated: DispatchRecord = {
      ...dispatch,
      delivery_status: "failed",
      error: {
        code,
        message,
        retryable,
        details
      }
    };
    this.writeDispatchRecord(updated);
    return updated;
  }

  getDispatches(): DispatchRecord[] {
    const rows = this.db
      .prepare("SELECT record_json FROM dispatches ORDER BY created_at ASC")
      .all() as Array<{ record_json: string }>;
    return rows.map((row) => deserializeJson<DispatchRecord>(row.record_json));
  }

  private getDispatchRecord(dispatchId: string): DispatchRecord | null {
    const row = this.db
      .prepare("SELECT record_json FROM dispatches WHERE dispatch_id = ?")
      .get(dispatchId) as { record_json: string } | undefined;
    return row ? deserializeJson<DispatchRecord>(row.record_json) : null;
  }

  private openEphemeralDatabase(): DatabaseSync {
    const db = new DatabaseSync(":memory:");
    this.initializeSchema(db);
    return db;
  }

  private openPersistentDatabase(
    persistenceConfig: NormalizedPersistenceConfig,
  ): DatabaseSync {
    mkdirSync(dirname(persistenceConfig.databasePath), { recursive: true });
    const db = new DatabaseSync(persistenceConfig.databasePath);
    db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.initializeSchema(db);
    this.migrateLegacySnapshotIfNeeded(db, persistenceConfig.legacySnapshotPath);
    return db;
  }

  private initializeSchema(db: DatabaseSync): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS approvals (
        approval_id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        record_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS jobs (
        job_id TEXT PRIMARY KEY,
        job_type TEXT NOT NULL,
        session_key TEXT NOT NULL,
        priority TEXT NOT NULL,
        approval_state TEXT NOT NULL,
        status TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        queued_at TEXT,
        updated_at TEXT NOT NULL,
        run_group TEXT,
        claim_id TEXT,
        claimed_by TEXT,
        lease_expires_at TEXT,
        last_heartbeat_at TEXT,
        record_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS dispatches (
        dispatch_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        created_at TEXT NOT NULL,
        session_key TEXT,
        job_id TEXT,
        delivery_status TEXT NOT NULL,
        delivered_at TEXT,
        record_json TEXT NOT NULL
      );
    `);
    db.prepare(
      "INSERT OR IGNORE INTO metadata (key, value) VALUES ('schema_version', '2')",
    ).run();
  }

  private migrateLegacySnapshotIfNeeded(
    db: DatabaseSync,
    legacySnapshotPath: string | undefined,
  ): void {
    if (!legacySnapshotPath || !existsSync(legacySnapshotPath)) {
      return;
    }

    const alreadyPopulated =
      this.countTable("approvals", db) > 0 ||
      this.countTable("jobs", db) > 0 ||
      this.countTable("dispatches", db) > 0;

    if (alreadyPopulated) {
      return;
    }

    const snapshot = readSnapshot(legacySnapshotPath);
    if (!snapshot) {
      return;
    }

    for (const approval of snapshot.approvals) {
      this.writeApprovalRecord(approval, db);
    }
    for (const job of snapshot.jobs) {
      this.writeJobRecord(
        {
          claim: job.claim ?? null,
          envelope: job.envelope,
          result: job.result
        },
        undefined,
        db,
      );
    }
    for (const dispatch of snapshot.dispatches) {
      this.writeDispatchRecord(
        {
          ...dispatch,
          delivery_status: dispatch.delivery_status ?? "pending"
        },
        db,
      );
    }

    db.prepare(
      "INSERT OR REPLACE INTO metadata (key, value) VALUES ('legacy_imported_at', ?)",
    ).run(nowIso());
  }

  private countTable(table: "approvals" | "jobs" | "dispatches", db = this.db): number {
    const ALLOWED_TABLES: Record<string, string> = {
      approvals: "approvals",
      jobs: "jobs",
      dispatches: "dispatches"
    };
    const safeName = ALLOWED_TABLES[table];
    if (!safeName) {
      throw new Error(`Invalid table name: ${table}`);
    }
    const row = db
      .prepare(`SELECT COUNT(*) AS count FROM ${safeName}`)
      .get() as { count: number };
    return row.count;
  }

  private writeApprovalRecord(record: ApprovalRecord, db = this.db): void {
    const timestamp = record.resolved_at ?? record.created_at;
    db.prepare(
      `
        INSERT INTO approvals (approval_id, state, created_at, updated_at, record_json)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(approval_id) DO UPDATE SET
          state = excluded.state,
          updated_at = excluded.updated_at,
          record_json = excluded.record_json
      `,
    ).run(
      record.approval_id,
      record.state,
      record.created_at,
      timestamp,
      serializeJson(record),
    );
  }

  private writeJobRecord(
    record: JobRecord,
    updatedAt = nowIso(),
    db = this.db,
  ): void {
    db.prepare(
      `
        INSERT INTO jobs (
          job_id,
          job_type,
          session_key,
          priority,
          approval_state,
          status,
          attempt,
          queued_at,
          updated_at,
          run_group,
          claim_id,
          claimed_by,
          lease_expires_at,
          last_heartbeat_at,
          record_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(job_id) DO UPDATE SET
          job_type = excluded.job_type,
          session_key = excluded.session_key,
          priority = excluded.priority,
          approval_state = excluded.approval_state,
          status = excluded.status,
          attempt = excluded.attempt,
          queued_at = excluded.queued_at,
          updated_at = excluded.updated_at,
          run_group = excluded.run_group,
          claim_id = excluded.claim_id,
          claimed_by = excluded.claimed_by,
          lease_expires_at = excluded.lease_expires_at,
          last_heartbeat_at = excluded.last_heartbeat_at,
          record_json = excluded.record_json
      `,
    ).run(
      record.envelope.job_id,
      record.envelope.type,
      record.envelope.session_key,
      record.envelope.priority,
      record.envelope.approval_state,
      record.result.status,
      record.envelope.attempt,
      record.result.metrics?.queued_at ?? null,
      updatedAt,
      typeof record.envelope.metadata.run_group === "string"
        ? record.envelope.metadata.run_group
        : null,
      record.claim?.claim_id ?? null,
      record.claim?.claimed_by ?? null,
      record.claim?.lease_expires_at ?? null,
      record.claim?.last_heartbeat_at ?? null,
      serializeJson(record),
    );
  }

  private writeDispatchRecord(record: DispatchRecord, db = this.db): void {
    db.prepare(
      `
        INSERT INTO dispatches (
          dispatch_id,
          kind,
          created_at,
          session_key,
          job_id,
          delivery_status,
          delivered_at,
          record_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(dispatch_id) DO UPDATE SET
          kind = excluded.kind,
          session_key = excluded.session_key,
          job_id = excluded.job_id,
          delivery_status = excluded.delivery_status,
          delivered_at = excluded.delivered_at,
          record_json = excluded.record_json
      `,
    ).run(
      record.dispatch_id,
      record.kind,
      record.created_at,
      record.session_key ?? null,
      record.job_id ?? null,
      record.delivery_status,
      record.delivered_at ?? null,
      serializeJson(record),
    );
  }

  private listJobRecords(): JobRecord[] {
    const rows = this.db
      .prepare("SELECT record_json FROM jobs ORDER BY updated_at ASC")
      .all() as Array<{ record_json: string }>;
    return rows.map((row) => deserializeJson<JobRecord>(row.record_json));
  }

  private isApprovalGranted(approvalId: string | undefined): boolean {
    if (!approvalId) {
      return false;
    }
    return this.getApproval(approvalId)?.state === "approved";
  }

  private buildEnvelope(
    params: SubmitJobParams,
    approvalGranted: boolean,
  ): JobEnvelope {
    const queuedAt = nowIso();
    const attempt = Math.max(1, params.attempt ?? 1);

    return {
      contract_version: CONTRACT_VERSION,
      job_id: randomUUID(),
      type: params.type,
      session_key: params.ctx?.sessionKey ?? "agent:main:api:local:adhoc",
      requested_by: {
        channel: params.ctx?.messageChannel ?? "api",
        user_id: params.ctx?.requesterSenderId ?? "system"
      },
      priority: params.priority ?? "normal",
      approval_state: deriveUpdatedApprovalState(params.type, approvalGranted),
      timeout_seconds: JOB_TIMEOUT_SECONDS[params.type],
      attempt,
      input: params.input,
      artifacts_in: params.artifactsIn ?? [],
      retry_policy: {
        mode: "manual",
        max_attempts: 3
      },
      metadata: {
        agent_id: params.ctx?.agentId ?? "main",
        thread_key: null,
        requested_command: params.requestedCommand,
        capability_route: params.capabilityRoute,
        notify_on_completion: params.notifyOnCompletion ?? false,
        run_group: params.runGroup,
        queued_at: queuedAt
      }
    };
  }

  private toToolStatus(status: JarvisJobStatus): JarvisToolStatus {
    switch (status) {
      case "queued":
        return "accepted";
      case "running":
        return "in_progress";
      case "awaiting_approval":
        return "awaiting_approval";
      case "completed":
        return "completed";
      case "failed":
        return "failed";
      case "cancelled":
        return "cancelled";
      default:
        return "failed";
    }
  }
}

const initialPersistenceConfig = normalizePersistenceConfig({
  databasePath: process.env.JARVIS_STATE_DB ?? "",
  filePath: process.env.JARVIS_STATE_FILE ?? ""
});

let sharedState: JarvisState | null = null;
let currentPersistenceConfig = initialPersistenceConfig;

export function getJarvisState(): JarvisState {
  if (!sharedState) {
    sharedState = new JarvisState(currentPersistenceConfig);
  }
  return sharedState;
}

export function configureJarvisStatePersistence(
  persistenceConfig: JarvisStatePersistenceConfig | null,
): void {
  currentPersistenceConfig = normalizePersistenceConfig(persistenceConfig);
  if (sharedState) {
    sharedState.configurePersistence(currentPersistenceConfig);
  }
}

export function resetJarvisState(
  options: JarvisStateResetOptions = {},
): void {
  if (options.preservePersistence) {
    sharedState?.close();
    sharedState = null;
    return;
  }

  getJarvisState().reset();
}
