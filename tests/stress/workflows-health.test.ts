/**
 * Stress: Workflows + Status Writer
 *
 * Tests V1_WORKFLOWS definitions, StatusWriter multi-run tracking,
 * and safe mode behavior.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { V1_WORKFLOWS, StatusWriter, RunStore } from "@jarvis/runtime";
import { createStressDb, cleanupDb, range } from "./helpers.js";

// ── Workflow Definitions ────────────────────────────────────────────────────

describe("V1 Workflows", () => {
  it("all workflows have required fields", () => {
    expect(V1_WORKFLOWS.length).toBeGreaterThan(0);

    for (const wf of V1_WORKFLOWS) {
      expect(wf.workflow_id).toBeTruthy();
      expect(wf.name).toBeTruthy();
      expect(wf.description).toBeTruthy();
      expect(wf.agent_ids.length).toBeGreaterThan(0);
      expect(wf.expected_output).toBeTruthy();
      expect(Array.isArray(wf.inputs)).toBe(true);
      expect(wf.approval_summary).toBeTruthy();
      expect(typeof wf.preview_available).toBe("boolean");
    }
  });

  it("workflow IDs are unique", () => {
    const ids = V1_WORKFLOWS.map(wf => wf.workflow_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("all workflow inputs have required structure", () => {
    for (const wf of V1_WORKFLOWS) {
      for (const input of wf.inputs) {
        expect(input.name).toBeTruthy();
        expect(input.label).toBeTruthy();
        expect(["text", "file", "select", "date", "checkbox"]).toContain(input.type);
        expect(typeof input.required).toBe("boolean");
      }
    }
  });

  it("contract-review workflow exists with correct agent", () => {
    const contractReview = V1_WORKFLOWS.find(wf => wf.workflow_id === "contract-review");
    expect(contractReview).toBeDefined();
    expect(contractReview!.agent_ids).toContain("contract-reviewer");
  });

  it("rfq-analysis workflow uses multiple agents", () => {
    const rfq = V1_WORKFLOWS.find(wf => wf.workflow_id === "rfq-analysis");
    expect(rfq).toBeDefined();
    expect(rfq!.agent_ids.length).toBeGreaterThanOrEqual(2);
  });

  it("workflows with safety rules have valid structure", () => {
    for (const wf of V1_WORKFLOWS) {
      if (wf.safety_rules) {
        expect(["draft", "send", "blocked"]).toContain(wf.safety_rules.outbound_default);
        expect(typeof wf.safety_rules.preview_recommended).toBe("boolean");
        expect(typeof wf.safety_rules.retry_safe).toBe("boolean");
        expect(typeof wf.safety_rules.retry_requires_approval).toBe("boolean");
      }
    }
  });

  it("workflows with output fields have valid structure", () => {
    for (const wf of V1_WORKFLOWS) {
      if (wf.output_fields) {
        for (const field of wf.output_fields) {
          expect(field.name).toBeTruthy();
          expect(field.label).toBeTruthy();
          expect(["text", "list", "document", "table"]).toContain(field.type);
          expect(typeof field.required).toBe("boolean");
        }
      }
    }
  });
});

// ── Status Writer ───────────────────────────────────────────────────────────

describe("StatusWriter", () => {
  let db: DatabaseSync;
  let dbPath: string;

  beforeEach(() => {
    ({ db, path: dbPath } = createStressDb("status"));
  });

  afterEach(() => cleanupDb(db, dbPath));

  it("tracks single run lifecycle", () => {
    const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any;
    const writer = new StatusWriter(14, 8, logger, db);

    writer.setCurrentRun("bd-pipeline", 5);
    writer.updateStep(1, "email.search");
    writer.updateStep(2, "crm.list_pipeline");
    writer.updateStep(3, "web.search_news");
    writer.setAwaitingApproval(4, "email.send");
    writer.updateStep(4, "email.send");
    writer.updateStep(5, "crm.update_contact");
    writer.completeRun("completed");

    // No crash = success (StatusWriter is fire-and-forget)
  });

  it("safe mode toggling", () => {
    const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any;
    const writer = new StatusWriter(14, 8, logger, db);

    writer.setSafeMode(true, "Database migration in progress");
    writer.setSafeMode(false, null);
    writer.setSafeMode(true, "Manual hold requested by operator");
    writer.setSafeMode(false, null);
  });

  it("multiple runs tracked concurrently", () => {
    const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any;
    const writer = new StatusWriter(14, 8, logger, db);

    // Start 3 runs
    writer.setCurrentRun("bd-pipeline", 5);
    writer.setCurrentRun("proposal-engine", 3);
    writer.setCurrentRun("evidence-auditor", 4);

    // Update steps on different agents
    writer.updateStep(1, "email.search", "bd-pipeline");
    writer.updateStep(1, "document.ingest", "proposal-engine");
    writer.updateStep(1, "document.analyze_compliance", "evidence-auditor");

    // Complete one
    writer.completeRun("completed", "bd-pipeline");

    // Others continue
    writer.updateStep(2, "document.extract_clauses", "proposal-engine");
    writer.completeRun("completed", "proposal-engine");
    writer.completeRun("completed", "evidence-auditor");
  });

  it("updateTotalSteps mid-run", () => {
    const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any;
    const writer = new StatusWriter(14, 8, logger, db);

    writer.setCurrentRun("bd-pipeline", 3);
    writer.updateStep(1, "email.search");
    writer.updateTotalSteps(7); // Plan expanded mid-run
    writer.updateStep(2, "crm.search");
    writer.completeRun("completed");
  });

  it("rapid status updates don't crash", () => {
    const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any;
    const writer = new StatusWriter(14, 8, logger, db);

    // Simulate rapid-fire updates
    for (let i = 0; i < 100; i++) {
      writer.setCurrentRun(`agent-${i % 5}`, 5);
      writer.updateStep(i % 5, `action.step_${i % 5}`, `agent-${i % 5}`);
      if (i % 10 === 0) {
        writer.completeRun("completed", `agent-${i % 5}`);
      }
    }
  });
});

// ── Combined: Run lifecycle with status tracking ────────────────────────────

describe("Run Lifecycle + Status", () => {
  let db: DatabaseSync;
  let dbPath: string;

  beforeEach(() => {
    ({ db, path: dbPath } = createStressDb("lifecycle-status"));
  });

  afterEach(() => cleanupDb(db, dbPath));

  it("10 sequential runs with full status tracking", () => {
    const store = new RunStore(db);
    const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any;
    const writer = new StatusWriter(14, 8, logger, db);
    const agents = [
      "bd-pipeline", "proposal-engine", "evidence-auditor",
      "contract-reviewer", "staffing-monitor", "content-engine",
      "portfolio-monitor", "garden-calendar", "email-campaign", "security-monitor",
    ];

    for (let i = 0; i < 10; i++) {
      const agentId = agents[i];
      const runId = store.startRun(agentId, "sequential-test");
      writer.setCurrentRun(agentId, 3);

      store.transition(runId, agentId, "executing", "plan_built");

      for (let step = 1; step <= 3; step++) {
        const action = `${agentId.split("-")[0]}.step_${step}`;
        store.emitEvent(runId, agentId, "step_completed", { step_no: step, action });
        writer.updateStep(step, action, agentId);
      }

      store.transition(runId, agentId, "completed", "run_completed", { step_no: 3 });
      writer.completeRun("completed", agentId);
    }

    const allRuns = store.getRecentRuns(20);
    expect(allRuns.filter(r => r.status === "completed")).toHaveLength(10);
  });
});
