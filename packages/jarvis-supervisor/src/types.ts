import type { JobEnvelope, JobResult, WorkerCallback } from "@jarvis/shared";

export type SupervisorRoute = "device" | "office" | "python" | "browser" | "system" | "inference" | "security" | "interpreter" | "voice" | "agent" | "calendar" | "email" | "web" | "crm" | "document";

export type SupervisorJobClaim = {
  claim_id: string;
  lease_expires_at?: string;
  worker_id?: string;
  run_group?: string;
  job: JobEnvelope;
};

export type SupervisorClaimRequest = {
  worker_id: string;
  routes: SupervisorRoute[];
  run_group?: string;
  max_jobs?: number;
};

export type SupervisorHeartbeatRequest = {
  claim_id: string;
  job_id: string;
  job_type: string;
  attempt: number;
  worker_id: string;
  route: SupervisorRoute;
  status: "running" | "awaiting_approval";
  summary?: string;
};

export type SupervisorRouteHandlerContext = {
  supervisor: import("./supervisor.js").JarvisSupervisor;
  job: JobEnvelope;
  claim: SupervisorJobClaim;
  route: SupervisorRoute;
  workerId: string;
  signal: AbortSignal;
  heartbeat: () => Promise<void>;
};

export type SupervisorRouteHandler = (
  context: SupervisorRouteHandlerContext,
) => Promise<JobResult> | JobResult;

export type SupervisorRouteHandlers = Partial<
  Record<SupervisorRoute, SupervisorRouteHandler>
>;

export type SupervisorRunOutcome =
  | {
      kind: "idle";
    }
  | {
      kind: "completed";
      claim: SupervisorJobClaim;
      result: JobResult;
    }
  | {
      kind: "failed";
      claim: SupervisorJobClaim;
      result: JobResult;
    };

export type SupervisorCallbackPayload = WorkerCallback & {
  claim_id: string;
  route: SupervisorRoute;
};

export type FetchLike = typeof fetch;
