import { describe, expect, it } from "vitest";
import { isMultiAgentGoal } from "@jarvis/runtime";
import { JobGraph } from "@jarvis/runtime";
import type { JobGraphData } from "@jarvis/runtime";

const AGENT_IDS = [
  "orchestrator", "self-reflection", "regulatory-watch", "knowledge-curator",
  "proposal-engine", "evidence-auditor", "contract-reviewer", "staffing-monitor",
];

// ─── Multi-agent goal detection ─────────────────────────────────────────────

describe("isMultiAgentGoal", () => {
  it("detects goals mentioning multiple agents", () => {
    expect(isMultiAgentGoal("Run the evidence auditor and then generate a proposal", AGENT_IDS)).toBe(true);
  });

  it("detects coordination keywords", () => {
    expect(isMultiAgentGoal("Create a comprehensive weekly report", AGENT_IDS)).toBe(true);
    expect(isMultiAgentGoal("Do a full review of everything", AGENT_IDS)).toBe(true);
    expect(isMultiAgentGoal("Audit evidence and then update staffing", AGENT_IDS)).toBe(true);
  });

  it("single-agent goals return false", () => {
    expect(isMultiAgentGoal("Review this NDA", AGENT_IDS)).toBe(false);
    expect(isMultiAgentGoal("Check crypto prices", AGENT_IDS)).toBe(false);
  });

  it("empty goal returns false", () => {
    expect(isMultiAgentGoal("", AGENT_IDS)).toBe(false);
  });
});

// ─── JobGraph DAG execution ─────────────────────────────────────────────────

describe("JobGraph DAG execution patterns", () => {
  it("sequential chain: A -> B -> C", () => {
    const graph: JobGraphData = {
      graph_id: "g1",
      root_goal: "Sequential",
      sub_goals: [
        { sub_goal_id: "a", parent_goal: "test", agent_id: "evidence-auditor", goal: "Audit", depends_on: [], status: "pending" },
        { sub_goal_id: "b", parent_goal: "test", agent_id: "proposal-engine", goal: "Propose", depends_on: ["a"], status: "pending" },
        { sub_goal_id: "c", parent_goal: "test", agent_id: "staffing-monitor", goal: "Staff", depends_on: ["b"], status: "pending" },
      ],
      created_at: new Date().toISOString(),
      status: "executing",
    };

    const jg = new JobGraph(graph);

    // Only A is ready initially
    expect(jg.getReady().map(sg => sg.sub_goal_id)).toEqual(["a"]);

    jg.markRunning("a", "r1");
    jg.markCompleted("a", "done");

    // Now B is ready
    expect(jg.getReady().map(sg => sg.sub_goal_id)).toEqual(["b"]);

    jg.markRunning("b", "r2");
    jg.markCompleted("b", "done");

    // Now C is ready
    expect(jg.getReady().map(sg => sg.sub_goal_id)).toEqual(["c"]);

    jg.markRunning("c", "r3");
    jg.markCompleted("c", "done");

    expect(jg.isComplete()).toBe(true);
  });

  it("diamond pattern: A -> {B, C} -> D", () => {
    const graph: JobGraphData = {
      graph_id: "g2",
      root_goal: "Diamond",
      sub_goals: [
        { sub_goal_id: "a", parent_goal: "test", agent_id: "regulatory-watch", goal: "Watch", depends_on: [], status: "pending" },
        { sub_goal_id: "b", parent_goal: "test", agent_id: "evidence-auditor", goal: "Audit", depends_on: ["a"], status: "pending" },
        { sub_goal_id: "c", parent_goal: "test", agent_id: "contract-reviewer", goal: "Review", depends_on: ["a"], status: "pending" },
        { sub_goal_id: "d", parent_goal: "test", agent_id: "proposal-engine", goal: "Propose", depends_on: ["b", "c"], status: "pending" },
      ],
      created_at: new Date().toISOString(),
      status: "executing",
    };

    const jg = new JobGraph(graph);

    // Only A ready
    expect(jg.getReady().map(sg => sg.sub_goal_id)).toEqual(["a"]);

    jg.markRunning("a", "r1");
    jg.markCompleted("a", "done");

    // B and C ready in parallel
    const ready = jg.getReady().map(sg => sg.sub_goal_id).sort();
    expect(ready).toEqual(["b", "c"]);

    jg.markRunning("b", "r2");
    jg.markRunning("c", "r3");
    jg.markCompleted("b", "done");

    // D not ready yet — C still running
    expect(jg.getReady()).toEqual([]);

    jg.markCompleted("c", "done");

    // Now D is ready
    expect(jg.getReady().map(sg => sg.sub_goal_id)).toEqual(["d"]);
  });

  it("failure cascade: A fails -> B and C skipped", () => {
    const graph: JobGraphData = {
      graph_id: "g3",
      root_goal: "Cascade",
      sub_goals: [
        { sub_goal_id: "a", parent_goal: "test", agent_id: "evidence-auditor", goal: "Audit", depends_on: [], status: "pending" },
        { sub_goal_id: "b", parent_goal: "test", agent_id: "proposal-engine", goal: "Propose", depends_on: ["a"], status: "pending" },
        { sub_goal_id: "c", parent_goal: "test", agent_id: "staffing-monitor", goal: "Staff", depends_on: ["a"], status: "pending" },
      ],
      created_at: new Date().toISOString(),
      status: "executing",
    };

    const jg = new JobGraph(graph);
    jg.markRunning("a", "r1");
    jg.markFailed("a", "timeout");

    // B and C should be skipped
    const result = jg.toJSON();
    const bStatus = result.sub_goals.find(sg => sg.sub_goal_id === "b")!.status;
    const cStatus = result.sub_goals.find(sg => sg.sub_goal_id === "c")!.status;
    expect(bStatus).toBe("skipped");
    expect(cStatus).toBe("skipped");
    expect(jg.isComplete()).toBe(true);
  });

  it("parallel independent goals: {A, B, C} with no deps", () => {
    const graph: JobGraphData = {
      graph_id: "g4",
      root_goal: "Parallel",
      sub_goals: [
        { sub_goal_id: "a", parent_goal: "test", agent_id: "evidence-auditor", goal: "Audit", depends_on: [], status: "pending" },
        { sub_goal_id: "b", parent_goal: "test", agent_id: "staffing-monitor", goal: "Staff", depends_on: [], status: "pending" },
        { sub_goal_id: "c", parent_goal: "test", agent_id: "regulatory-watch", goal: "Watch", depends_on: [], status: "pending" },
      ],
      created_at: new Date().toISOString(),
      status: "executing",
    };

    const jg = new JobGraph(graph);

    // All 3 ready at once
    expect(jg.getReady()).toHaveLength(3);
  });

  it("topological order respects dependencies", () => {
    const graph: JobGraphData = {
      graph_id: "g5",
      root_goal: "Topo",
      sub_goals: [
        { sub_goal_id: "c", parent_goal: "test", agent_id: "staffing-monitor", goal: "Staff", depends_on: ["a", "b"], status: "pending" },
        { sub_goal_id: "a", parent_goal: "test", agent_id: "evidence-auditor", goal: "Audit", depends_on: [], status: "pending" },
        { sub_goal_id: "b", parent_goal: "test", agent_id: "proposal-engine", goal: "Propose", depends_on: ["a"], status: "pending" },
      ],
      created_at: new Date().toISOString(),
      status: "executing",
    };

    const jg = new JobGraph(graph);
    const order = jg.topologicalOrder().map(sg => sg.sub_goal_id);

    const aIdx = order.indexOf("a");
    const bIdx = order.indexOf("b");
    const cIdx = order.indexOf("c");

    expect(aIdx).toBeLessThan(bIdx);
    expect(aIdx).toBeLessThan(cIdx);
    expect(bIdx).toBeLessThan(cIdx);
  });
});

// ─── Real scenarios ─────────────────────────────────────────────────────────

describe("orchestrated scenarios", () => {
  it("proposal scenario: evidence-auditor -> proposal-engine", () => {
    const graph: JobGraphData = {
      graph_id: "proposal-scenario",
      root_goal: "Analyze RFQ and generate proposal for Volvo",
      sub_goals: [
        { sub_goal_id: "audit", parent_goal: "Analyze RFQ and generate proposal for Volvo", agent_id: "evidence-auditor", goal: "Audit the attached RFQ for ISO 26262 compliance gaps", depends_on: [], status: "pending" },
        { sub_goal_id: "propose", parent_goal: "Analyze RFQ and generate proposal for Volvo", agent_id: "proposal-engine", goal: "Build a proposal based on the audit findings", depends_on: ["audit"], status: "pending" },
      ],
      created_at: new Date().toISOString(),
      status: "executing",
    };

    const jg = new JobGraph(graph);

    // Audit runs first
    expect(jg.getReady().map(sg => sg.agent_id)).toEqual(["evidence-auditor"]);

    jg.markRunning("audit", "run-1");
    jg.markCompleted("audit", "Gap matrix: 3 missing work products");

    // Now proposal can run
    expect(jg.getReady().map(sg => sg.agent_id)).toEqual(["proposal-engine"]);

    jg.markRunning("propose", "run-2");
    jg.markCompleted("propose", "Proposal document generated");

    expect(jg.isComplete()).toBe(true);
  });

  it("evidence package scenario: regulatory -> evidence + contract -> merge", () => {
    const graph: JobGraphData = {
      graph_id: "evidence-package",
      root_goal: "Build complete evidence package for gate review",
      sub_goals: [
        { sub_goal_id: "reg", parent_goal: "test", agent_id: "regulatory-watch", goal: "Check for standard changes since last audit", depends_on: [], status: "pending" },
        { sub_goal_id: "evi", parent_goal: "test", agent_id: "evidence-auditor", goal: "Audit evidence against updated baselines", depends_on: ["reg"], status: "pending" },
        { sub_goal_id: "con", parent_goal: "test", agent_id: "contract-reviewer", goal: "Verify DIA compliance", depends_on: ["reg"], status: "pending" },
        { sub_goal_id: "staff", parent_goal: "test", agent_id: "staffing-monitor", goal: "Check staffing for remediation", depends_on: ["evi", "con"], status: "pending" },
      ],
      created_at: new Date().toISOString(),
      status: "executing",
    };

    const jg = new JobGraph(graph);

    // Regulatory first
    expect(jg.getReady()).toHaveLength(1);
    jg.markRunning("reg", "r1");
    jg.markCompleted("reg", "2 ASPICE v4 changes found");

    // Evidence + Contract in parallel
    const ready = jg.getReady();
    expect(ready).toHaveLength(2);
    expect(ready.map(sg => sg.agent_id).sort()).toEqual(["contract-reviewer", "evidence-auditor"]);

    jg.markRunning("evi", "r2");
    jg.markRunning("con", "r3");
    jg.markCompleted("evi", "YELLOW: 2 gaps found");
    jg.markCompleted("con", "DIA compliant");

    // Staffing last
    expect(jg.getReady()).toHaveLength(1);
    jg.markRunning("staff", "r4");
    jg.markCompleted("staff", "2 engineers available for remediation");

    expect(jg.isComplete()).toBe(true);
  });
});
