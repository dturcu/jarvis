import {
  CONTRACT_VERSION,
  JarvisApprovalSeverity,
  JarvisApprovalState,
  JarvisJobStatus,
  JarvisJobType,
  JarvisPriority,
  JarvisToolStatus
} from "./contracts.js";

export type JarvisContractVersion = typeof CONTRACT_VERSION;

export type RequestedBy = {
  channel: string;
  user_id: string;
  message_id?: string;
  chat_id?: string;
  username?: string;
  display_name?: string;
};

export type ArtifactRef = {
  artifact_id: string;
  name?: string;
  kind?: string;
  path?: string;
  path_context?: string;
  path_style?: string;
  checksum_sha256?: string;
  size_bytes?: number;
};

export type ArtifactRecord = {
  artifact_id: string;
  kind: string;
  name: string;
  path?: string;
  path_context?: string;
  path_style?: string;
  size_bytes?: number;
  checksum_sha256?: string;
  mime_type?: string;
  created_at?: string;
  preview?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
};

export type RetryPolicy = {
  mode: "never" | "manual" | "exponential";
  max_attempts: number;
  initial_backoff_seconds?: number;
  max_backoff_seconds?: number;
};

export type LogEntry = {
  timestamp: string;
  level: "debug" | "info" | "warning" | "error";
  message: string;
  source?: string;
  data?: Record<string, unknown>;
};

export type Metrics = {
  queued_at?: string;
  started_at?: string;
  approved_at?: string;
  finished_at?: string;
  queue_seconds?: number;
  run_seconds?: number;
  attempt?: number;
  worker_id?: string;
};

export type JobClaim = {
  claim_id: string;
  claimed_by: string;
  lease_expires_at: string;
  last_heartbeat_at: string;
  run_group?: string;
};

export type JobError = {
  code: string;
  message: string;
  retryable: boolean;
  field?: string;
  external_code?: string;
  details?: Record<string, unknown>;
};

export type ApprovalRecord = {
  approval_id: string;
  state: Exclude<JarvisApprovalState, "not_required">;
  title: string;
  description: string;
  severity: JarvisApprovalSeverity;
  scopes: string[];
  created_at: string;
  resolved_at?: string;
};

export type ToolResponse = {
  contract_version: JarvisContractVersion;
  status: JarvisToolStatus;
  summary: string;
  job_id?: string;
  approval_id?: string;
  artifacts?: ArtifactRecord[];
  structured_output?: Record<string, unknown>;
  error?: JobError;
  logs?: LogEntry[];
  metrics?: Metrics;
};

export type JobEnvelope = {
  contract_version: JarvisContractVersion;
  job_id: string;
  type: JarvisJobType;
  session_key: string;
  requested_by: RequestedBy;
  priority: JarvisPriority;
  approval_state: JarvisApprovalState;
  timeout_seconds: number;
  attempt: number;
  input: Record<string, unknown>;
  artifacts_in: ArtifactRef[];
  retry_policy?: RetryPolicy;
  metadata: {
    agent_id: string;
    thread_key: string | null;
    correlation_id?: string;
    requested_command?: string;
    model_route?: string;
    capability_route?: string;
    notify_on_completion?: boolean;
    run_group?: string;
    approved_roots?: string[];
  } & Record<string, unknown>;
};

export type JobResult = {
  contract_version: JarvisContractVersion;
  job_id: string;
  job_type: JarvisJobType;
  status: JarvisJobStatus;
  summary: string;
  attempt: number;
  approval_id?: string;
  artifacts?: ArtifactRecord[];
  structured_output?: Record<string, unknown>;
  error?: JobError;
  logs?: LogEntry[];
  metrics?: Metrics;
};

export type WorkerCallback = {
  contract_version: JarvisContractVersion;
  job_id: string;
  job_type: JarvisJobType;
  attempt: number;
  status: JarvisJobStatus;
  summary: string;
  worker_id: string;
  approval_id?: string;
  artifacts?: ArtifactRecord[];
  structured_output?: Record<string, unknown>;
  error?: JobError;
  logs?: LogEntry[];
  metrics?: Metrics;
  claim_id?: string;
};

export type JobRecord = {
  envelope: JobEnvelope;
  result: JobResult;
  claim?: JobClaim | null;
};

export type DispatchRecord = {
  dispatch_id: string;
  kind:
    | "dispatch_to_session"
    | "dispatch_followup"
    | "dispatch_broadcast"
    | "dispatch_notify_completion"
    | "dispatch_spawn_worker_agent";
  session_key?: string;
  session_keys?: string[];
  text: string;
  job_id?: string;
  worker_type?: string;
  goal?: string;
  created_at: string;
  delivery_status: "pending" | "sent" | "failed";
  delivery_receipt?: Record<string, unknown>;
  delivered_at?: string;
  error?: JobError;
};

export type JsonObject = Record<string, unknown>;

export type JobClaimRequest = {
  worker_id: string;
  worker_type?: string;
  run_group?: string;
  routes?: string[];
  lease_seconds?: number;
  max_jobs?: number;
  requested_at?: string;
  metadata?: Record<string, unknown>;
};

export type JobClaimResult = {
  claimed: boolean;
  job_id?: string;
  claim_id?: string;
  status?: string;
  summary?: string;
  lease_expires_at?: string;
  attempt?: number;
  job_type?: JarvisJobType;
  job?: JobEnvelope;
  structured_output?: Record<string, unknown>;
  artifacts?: ArtifactRecord[];
  metrics?: Metrics;
};

export type JobHeartbeatRequest = {
  worker_id: string;
  job_id: string;
  claim_id: string;
  status?: string;
  summary?: string;
  heartbeat_at?: string;
  lease_seconds?: number;
  metadata?: Record<string, unknown>;
};

export type JobHeartbeatResult = {
  acknowledged: boolean;
  job_id: string;
  claim_id: string;
  status?: string;
  summary?: string;
  lease_expires_at?: string;
  attempt?: number;
  job_type?: JarvisJobType;
  structured_output?: Record<string, unknown>;
  artifacts?: ArtifactRecord[];
  metrics?: Metrics;
};
