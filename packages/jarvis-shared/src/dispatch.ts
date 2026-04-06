import { KNOWN_DISPATCH_KINDS } from "./contracts.js";
import { getJarvisState } from "./state.js";
import type { ToolResponse } from "./types.js";

export type DispatchToSessionParams = {
  sessionKey: string;
  text: string;
  approvalId?: string;
};

export type DispatchFollowupParams = {
  jobId: string;
  text: string;
  approvalId?: string;
};

export type DispatchBroadcastParams = {
  sessionKeys: string[];
  text: string;
  approvalId?: string;
};

export type DispatchNotifyCompletionParams = {
  jobId: string;
  text?: string;
  approvalId?: string;
};

export type DispatchSpawnWorkerAgentParams = {
  sessionKey: string;
  goal: string;
  workerType: string;
  approvalId?: string;
};

function ensureKnownDispatchKind(kind: string): void {
  if (!KNOWN_DISPATCH_KINDS.has(kind)) {
    throw new Error(`Unknown dispatch kind ${kind}`);
  }
}

export function dispatchToSession(params: DispatchToSessionParams): ToolResponse {
  ensureKnownDispatchKind("dispatch_to_session");
  return getJarvisState().createDispatch({
    kind: "dispatch_to_session",
    sessionKey: params.sessionKey,
    text: params.text,
    approvalId: params.approvalId,
    requireApproval: true
  });
}

export function dispatchFollowup(params: DispatchFollowupParams): ToolResponse {
  ensureKnownDispatchKind("dispatch_followup");
  return getJarvisState().createDispatch({
    kind: "dispatch_followup",
    jobId: params.jobId,
    text: params.text,
    approvalId: params.approvalId,
    requireApproval: false
  });
}

export function dispatchBroadcast(params: DispatchBroadcastParams): ToolResponse {
  ensureKnownDispatchKind("dispatch_broadcast");
  return getJarvisState().createDispatch({
    kind: "dispatch_broadcast",
    sessionKeys: params.sessionKeys,
    text: params.text,
    approvalId: params.approvalId,
    requireApproval: true
  });
}

export function dispatchNotifyCompletion(
  params: DispatchNotifyCompletionParams,
): ToolResponse {
  ensureKnownDispatchKind("dispatch_notify_completion");
  return getJarvisState().createDispatch({
    kind: "dispatch_notify_completion",
    jobId: params.jobId,
    text: params.text ?? `Job ${params.jobId} completed.`,
    approvalId: params.approvalId,
    requireApproval: false
  });
}

export function dispatchSpawnWorkerAgent(
  params: DispatchSpawnWorkerAgentParams,
): ToolResponse {
  ensureKnownDispatchKind("dispatch_spawn_worker_agent");
  return getJarvisState().createDispatch({
    kind: "dispatch_spawn_worker_agent",
    sessionKey: params.sessionKey,
    text: `Spawn ${params.workerType} worker agent`,
    workerType: params.workerType,
    goal: params.goal,
    approvalId: params.approvalId,
    requireApproval: true
  });
}
