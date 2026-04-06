import type { KnowledgeStore, KnowledgeCollection, KnowledgeDocument } from "./knowledge.js";
import type { AgentRun } from "./runtime.js";
import type { DecisionLog } from "./memory.js";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Common write interface satisfied by both in-memory KnowledgeStore and
 * SqliteKnowledgeStore.  Allows LessonCapture to persist lessons to either
 * store without hard-coupling to a concrete class.
 */
export interface KnowledgeWriter {
  addDocument(
    params: Omit<KnowledgeDocument, "doc_id" | "created_at" | "updated_at">,
  ): KnowledgeDocument;
}

export type LessonSeverity = "observation" | "recommendation" | "critical";

export type CapturedLesson = {
  agent_id: string;
  run_id: string;
  title: string;
  body: string;
  severity: LessonSeverity;
  tags: string[];
  collection: KnowledgeCollection;
};

export type CasestudyFragment = {
  agent_id: string;
  run_id: string;
  client?: string;
  scope: string;
  outcome: string;
  key_challenges: string[];
  collection: KnowledgeCollection;
};

// ─── AGENT → COLLECTION MAPPING ──────────────────────────────────────────────

const AGENT_DEFAULT_COLLECTION: Record<string, KnowledgeCollection> = {
  "bd-pipeline": "lessons",
  "proposal-engine": "proposals",
  "evidence-auditor": "iso26262",
  "contract-reviewer": "contracts",
  "staffing-monitor": "lessons",
  "content-engine": "lessons",
  "portfolio-monitor": "lessons",
  "garden-calendar": "garden",
};

function resolveCollection(agentId: string): KnowledgeCollection {
  return AGENT_DEFAULT_COLLECTION[agentId] ?? "lessons";
}

// ─── LessonCapture ────────────────────────────────────────────────────────────

/**
 * Post-run lesson extractor.
 * After each agent run completes, this module synthesises lessons from the
 * decision log and run outcome, then stores them in the knowledge store.
 *
 * In production the extraction would call inference.chat (haiku tier) with
 * the decision log as context. Here we produce deterministic lessons from the
 * decision log structure so the system is testable without inference calls.
 */
export class LessonCapture {
  constructor(private readonly store: KnowledgeWriter) {}

  /**
   * Extract and persist lessons from a completed run + its decision log.
   * Returns the list of lessons that were stored.
   */
  captureFromRun(run: AgentRun, decisions: DecisionLog[]): CapturedLesson[] {
    if (run.status !== "completed" && run.status !== "failed") {
      return []; // Only capture from terminal runs
    }

    const lessons: CapturedLesson[] = [];
    const collection = resolveCollection(run.agent_id);

    // 1. Capture a run-level lesson from the overall outcome
    if (run.status === "failed" && run.error) {
      const lesson: CapturedLesson = {
        agent_id: run.agent_id,
        run_id: run.run_id,
        title: `[${run.agent_id}] Run failed: ${run.error.slice(0, 80)}`,
        body: `Agent run ${run.run_id} failed after ${run.current_step} step(s). Error: ${run.error}. Goal: ${run.goal}. Investigate root cause before next run.`,
        severity: "critical",
        tags: [run.agent_id, "failure", "run-error"],
        collection,
      };
      lessons.push(lesson);
    } else if (run.status === "completed" && run.current_step > 0) {
      const lesson: CapturedLesson = {
        agent_id: run.agent_id,
        run_id: run.run_id,
        title: `[${run.agent_id}] Run completed in ${run.current_step} step(s)`,
        body: `Agent run ${run.run_id} completed successfully. Goal: ${run.goal}. Steps executed: ${run.current_step}/${run.total_steps}.`,
        severity: "observation",
        tags: [run.agent_id, "completion", "run-summary"],
        collection,
      };
      lessons.push(lesson);
    }

    // 2. Capture lessons from individual decision log entries that carry outcome data
    for (const decision of decisions) {
      if (!decision.outcome || decision.outcome === "pending") continue;

      const severity: LessonSeverity =
        decision.outcome.toLowerCase().includes("fail") ||
        decision.outcome.toLowerCase().includes("error")
          ? "recommendation"
          : "observation";

      const lesson: CapturedLesson = {
        agent_id: run.agent_id,
        run_id: run.run_id,
        title: `[${run.agent_id}] Step ${decision.step}: ${decision.action}`,
        body: `Action: ${decision.action}\nReasoning: ${decision.reasoning}\nOutcome: ${decision.outcome}`,
        severity,
        tags: [run.agent_id, `step-${decision.step}`, decision.action.split(".")[0] ?? "unknown"],
        collection,
      };
      lessons.push(lesson);
    }

    // Persist all lessons to the knowledge store
    for (const lesson of lessons) {
      this.store.addDocument({
        collection: lesson.collection,
        title: lesson.title,
        content: lesson.body,
        tags: lesson.tags,
        source_agent_id: lesson.agent_id,
        source_run_id: lesson.run_id,
      });
    }

    return lessons;
  }

  /**
   * Capture a case-study fragment from a completed delivery run.
   * Used by evidence-auditor and proposal-engine to build the case-study corpus.
   */
  captureCasestudy(fragment: CasestudyFragment): void {
    const title = fragment.client
      ? `Case study: ${fragment.client} — ${fragment.scope}`
      : `Case study: ${fragment.scope}`;

    const body = [
      `Scope: ${fragment.scope}`,
      `Outcome: ${fragment.outcome}`,
      fragment.key_challenges.length > 0
        ? `Key challenges:\n${fragment.key_challenges.map(c => `- ${c}`).join("\n")}`
        : null,
    ]
      .filter(Boolean)
      .join("\n\n");

    this.store.addDocument({
      collection: "case-studies",
      title,
      content: body,
      tags: [
        "case-study",
        fragment.agent_id,
        ...(fragment.client ? [fragment.client.toLowerCase().replace(/\s+/g, "-")] : []),
      ],
      source_agent_id: fragment.agent_id,
      source_run_id: fragment.run_id,
    });
  }

  /**
   * Manually persist a lesson without a full run context.
   * Useful when an agent wants to capture a domain insight mid-run.
   */
  captureManual(lesson: Omit<CapturedLesson, "collection"> & { collection?: KnowledgeCollection }): void {
    const collection = lesson.collection ?? resolveCollection(lesson.agent_id);
    this.store.addDocument({
      collection,
      title: lesson.title,
      content: lesson.body,
      tags: lesson.tags,
      source_agent_id: lesson.agent_id,
      source_run_id: lesson.run_id,
    });
  }
}
