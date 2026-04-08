/**
 * Schedule trigger abstraction — decouples the daemon's polling loop
 * from the concrete schedule storage backend.
 *
 * Two built-in implementations:
 *
 *  1. **DbScheduleTrigger** — wraps DbSchedulerStore, used when the daemon
 *     itself is responsible for evaluating cron expressions and firing agents.
 *
 *  2. **ExternalTriggerSource** — a no-op source for when an external system
 *     (e.g. OpenClaw TaskFlow) owns the schedule evaluation and pushes
 *     agent runs directly via `enqueueAgent()`.  `getDueSchedules()` always
 *     returns an empty list because the external system handles timing.
 *
 * Select the active source via `JARVIS_SCHEDULE_SOURCE` env var:
 *   - `db`       — DbScheduleTrigger (default)
 *   - `external` — ExternalTriggerSource
 */

import type { DbSchedulerStore } from "./db-scheduler.js";
import type { ScheduleRecord } from "@jarvis/scheduler";
import { invokeGatewayMethod } from "@jarvis/shared";

// ─── Public types ────────────────────────────────────────────────────────────

/** Minimal schedule payload returned by a trigger source. */
export type DueSchedule = {
  schedule_id: string;
  agent_id: string;
  cron_expression: string;
  label?: string;
};

/** Interface for schedule trigger sources. */
export interface ScheduleTriggerSource {
  /** The kind of source for logging / diagnostics. */
  readonly kind: "db" | "external" | "taskflow";

  /** Get schedules that are due to fire now. */
  getDueSchedules(now: Date): DueSchedule[];

  /**
   * Mark a schedule as fired and compute next fire time.
   * No-op for external sources (the external system manages timing).
   */
  markFired(scheduleId: string, now: Date): void;
}

// ─── DbScheduleTrigger ──────────────────────────────────────────────────────

/**
 * Adapter wrapping DbSchedulerStore as a ScheduleTriggerSource.
 *
 * Translates ScheduleRecord rows into the leaner DueSchedule shape and
 * delegates markFired + next-fire-at computation to the underlying store.
 */
export function createDbScheduleTrigger(
  store: DbSchedulerStore,
  computeNextFireAt: (schedule: ScheduleRecord, now: Date) => string,
): ScheduleTriggerSource {
  return {
    kind: "db",

    getDueSchedules(now: Date): DueSchedule[] {
      const records = store.getDueSchedules(now);
      return records.map((r) => ({
        schedule_id: r.schedule_id,
        agent_id: (r.input as { agent_id: string }).agent_id,
        cron_expression: r.cron_expression!,
        label: r.label,
      }));
    },

    markFired(scheduleId: string, now: Date): void {
      store.markFired(scheduleId);

      // Recompute next fire time from the raw ScheduleRecord.
      // getDueSchedules already filtered to enabled + past-due, so we
      // reconstruct a minimal ScheduleRecord for the computation helper.
      // The store's own getDueSchedules won't return it again until the
      // new next_fire_at is reached.
      const dueRecords = store.getDueSchedules(new Date(0)); // all enabled
      const record = dueRecords.find((r) => r.schedule_id === scheduleId);
      if (record) {
        const nextFire = computeNextFireAt(record, now);
        store.updateNextFireAt(scheduleId, nextFire);
      }
    },
  };
}

// ─── ExternalTriggerSource ──────────────────────────────────────────────────

/**
 * Adapter for OpenClaw TaskFlow triggers.
 *
 * When OpenClaw fires a schedule, it calls enqueueAgent() directly on the
 * agent queue — the daemon never needs to poll for due schedules.
 * This source always returns empty from getDueSchedules() because OpenClaw
 * handles the timing externally.
 */
export function createExternalTriggerSource(): ScheduleTriggerSource {
  return {
    kind: "external",

    getDueSchedules(_now: Date): DueSchedule[] {
      // External system (OpenClaw TaskFlow) handles schedule evaluation.
      return [];
    },

    markFired(_scheduleId: string, _now: Date): void {
      // No-op — the external system manages fire tracking.
    },
  };
}

// ─── TaskFlowTriggerSource (Epic 3) ────────────────────────────────────────

/**
 * Configuration for TaskFlow workflow registration.
 */
export type TaskFlowWorkflowConfig = {
  /** Jarvis schedule ID mapped to this workflow. */
  schedule_id: string;
  /** OpenClaw TaskFlow workflow ID. */
  taskflow_workflow_id: string;
  /** Correlation key between TaskFlow run and Jarvis run. */
  correlation_key?: string;
};

/**
 * Predefined TaskFlow workflow templates for the 6 candidate workflows
 * identified in the Platform Adoption Roadmap (Epic 3).
 */
export const TASKFLOW_WORKFLOW_TEMPLATES: Array<{
  name: string;
  agent_id: string;
  description: string;
  steps: string[];
  schedule_cron?: string;
}> = [
  {
    name: "lead-intake",
    agent_id: "orchestrator",
    description: "Inbound lead intake: normalize, enrich, classify, route to CRM pipeline",
    steps: ["normalize_contact", "enrich_company_data", "classify_opportunity", "create_crm_entry", "notify_operator"],
    schedule_cron: undefined, // webhook-triggered, not scheduled
  },
  {
    name: "proposal-generation",
    agent_id: "proposal-engine",
    description: "Proposal pack generation: analyze RFQ, build quote, generate deliverables, review",
    steps: ["analyze_rfq", "estimate_effort", "build_quote", "generate_proposal_doc", "submit_for_approval"],
    schedule_cron: undefined, // on-demand
  },
  {
    name: "contract-triage",
    agent_id: "contract-reviewer",
    description: "Contract triage: ingest document, extract clauses, risk assessment, produce recommendation",
    steps: ["ingest_document", "extract_clauses", "assess_risk", "produce_recommendation", "notify_operator"],
    schedule_cron: undefined, // on-demand
  },
  {
    name: "regulatory-digest",
    agent_id: "regulatory-watch",
    description: "Regulatory monitoring digest: scan sources, extract changes, assess impact, compile digest",
    steps: ["scan_regulatory_sources", "extract_changes", "assess_impact", "compile_digest", "distribute"],
    schedule_cron: "0 7 * * 1", // Weekly Monday 7 AM
  },
  {
    name: "delivery-readiness",
    agent_id: "evidence-auditor",
    description: "Weekly delivery-readiness report: audit evidence, check gaps, compile matrix, notify",
    steps: ["collect_evidence_status", "check_gaps", "compile_gap_matrix", "generate_report", "distribute"],
    schedule_cron: "0 8 * * 5", // Weekly Friday 8 AM
  },
  {
    name: "health-escalation",
    agent_id: "orchestrator",
    description: "System health escalation: check daemon, workers, queues, models, escalate if needed",
    steps: ["check_daemon_health", "check_worker_health", "check_queue_depth", "check_model_availability", "escalate_if_needed"],
    schedule_cron: "*/30 * * * *", // Every 30 minutes
  },
];

/**
 * Adapter for managed OpenClaw TaskFlow-backed scheduling (Epic 3).
 *
 * Unlike ExternalTriggerSource (which is a passive no-op), TaskFlowTriggerSource
 * actively registers Jarvis schedules as TaskFlow workflows and responds to
 * TaskFlow trigger callbacks. The daemon operates in "event-reactive" mode:
 * instead of polling getDueSchedules(), it listens for TaskFlow events.
 *
 * Select via JARVIS_SCHEDULE_SOURCE=taskflow.
 */
/** Registered workflow state tracked by the TaskFlow trigger source. */
type RegisteredWorkflow = TaskFlowWorkflowConfig & {
  registered: boolean;
  last_fire?: string;
};

/**
 * Creates a TaskFlow trigger source that registers workflows with the
 * OpenClaw gateway and handles callback events.
 *
 * Lifecycle:
 *   1. On creation, attempts to register all configured workflows via
 *      `taskflow.register_workflow`. Failures are logged but not fatal.
 *   2. getDueSchedules() returns nothing — TaskFlow pushes triggers.
 *   3. markFired() records fire timestamp and notifies TaskFlow.
 *   4. cancelFlow() propagates cancellation to the gateway.
 *
 * Select via JARVIS_SCHEDULE_SOURCE=taskflow.
 */
export function createTaskFlowTriggerSource(config?: {
  workflows?: TaskFlowWorkflowConfig[];
}): ScheduleTriggerSource & {
  /** Register all workflows with the OpenClaw TaskFlow gateway. */
  registerWorkflows(): Promise<{ registered: number; failed: number }>;
  /** Cancel a running flow, propagating to both gateway and Jarvis state. */
  cancelFlow(flowId: string): Promise<boolean>;
  /** Get the current registration state. */
  getRegisteredWorkflows(): RegisteredWorkflow[];
  /** Handle a callback event from OpenClaw TaskFlow. Returns the agent_id to enqueue, or null. */
  handleCallback(event: { flow_id: string; workflow_name: string; step?: string; action: "fire" | "cancel" | "complete" }): { agent_id: string; flow_id: string } | null;
} {
  const registeredWorkflows: RegisteredWorkflow[] = (config?.workflows ?? []).map((w) => ({
    ...w,
    registered: false,
  }));

  const source = {
    kind: "taskflow" as const,

    getDueSchedules(_now: Date): DueSchedule[] {
      // TaskFlow pushes triggers via callbacks — no polling needed.
      return [];
    },

    markFired(scheduleId: string, _now: Date): void {
      const workflow = registeredWorkflows.find((w) => w.schedule_id === scheduleId);
      if (workflow) {
        workflow.last_fire = _now.toISOString();
        // Notify TaskFlow that the schedule fired (best-effort)
        invokeGatewayMethod("taskflow.step_completed", undefined, {
          workflow_id: workflow.taskflow_workflow_id,
          schedule_id: scheduleId,
          fired_at: workflow.last_fire,
        }).catch(() => { /* gateway may be unavailable */ });
      }
    },

    async registerWorkflows(): Promise<{ registered: number; failed: number }> {
      let registered = 0;
      let failed = 0;

      for (const workflow of registeredWorkflows) {
        try {
          await invokeGatewayMethod("taskflow.register_workflow", undefined, {
            workflow_id: workflow.taskflow_workflow_id,
            schedule_id: workflow.schedule_id,
            correlation_key: workflow.correlation_key,
          });
          workflow.registered = true;
          registered++;
        } catch {
          failed++;
        }
      }

      return { registered, failed };
    },

    async cancelFlow(flowId: string): Promise<boolean> {
      try {
        await invokeGatewayMethod("taskflow.cancel", undefined, { flow_id: flowId });
        return true;
      } catch {
        return false;
      }
    },

    getRegisteredWorkflows(): RegisteredWorkflow[] {
      return [...registeredWorkflows];
    },

    handleCallback(event: {
      flow_id: string;
      workflow_name: string;
      step?: string;
      action: "fire" | "cancel" | "complete";
    }): { agent_id: string; flow_id: string } | null {
      if (event.action !== "fire") return null;

      // Find the template matching this workflow name
      const template = TASKFLOW_WORKFLOW_TEMPLATES.find((t) => t.name === event.workflow_name);
      if (!template) return null;

      return { agent_id: template.agent_id, flow_id: event.flow_id };
    },
  };

  return source;
}
