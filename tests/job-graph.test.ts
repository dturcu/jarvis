import { describe, expect, it } from "vitest";
import { JobGraph } from "../packages/jarvis-runtime/src/job-graph.js";
import type { JobGraphData } from "../packages/jarvis-runtime/src/orchestration-types.js";

function makeGraph(overrides?: Partial<JobGraphData>): JobGraphData {
  return {
    graph_id: "test-graph",
    root_goal: "Win the XYZ project",
    sub_goals: [
      { sub_goal_id: "sg1", parent_goal: "Win XYZ", agent_id: "bd-pipeline", goal: "Research company", depends_on: [], status: "pending" },
      { sub_goal_id: "sg2", parent_goal: "Win XYZ", agent_id: "proposal-engine", goal: "Draft proposal", depends_on: ["sg1"], status: "pending" },
      { sub_goal_id: "sg3", parent_goal: "Win XYZ", agent_id: "content-engine", goal: "Draft intro email", depends_on: ["sg1"], status: "pending" },
    ],
    created_at: new Date().toISOString(),
    status: "executing",
    ...overrides,
  };
}

describe("JobGraph", () => {
  it("validates a valid DAG without throwing", () => {
    expect(() => new JobGraph(makeGraph())).not.toThrow();
  });

  it("rejects a graph with cycles", () => {
    expect(() => new JobGraph(makeGraph({
      sub_goals: [
        { sub_goal_id: "a", parent_goal: "", agent_id: "x", goal: "", depends_on: ["b"], status: "pending" },
        { sub_goal_id: "b", parent_goal: "", agent_id: "x", goal: "", depends_on: ["a"], status: "pending" },
      ],
    }))).toThrow(/[Cc]ycle/);
  });

  it("rejects a graph with unknown dependencies", () => {
    expect(() => new JobGraph(makeGraph({
      sub_goals: [
        { sub_goal_id: "a", parent_goal: "", agent_id: "x", goal: "", depends_on: ["nonexistent"], status: "pending" },
      ],
    }))).toThrow(/unknown/);
  });

  it("getReady returns only nodes with all deps completed", () => {
    const graph = new JobGraph(makeGraph());
    const ready = graph.getReady();
    expect(ready).toHaveLength(1);
    expect(ready[0].sub_goal_id).toBe("sg1");
  });

  it("getReady unlocks dependents after completion", () => {
    const graph = new JobGraph(makeGraph());
    graph.markCompleted("sg1", "Done");

    const ready = graph.getReady();
    expect(ready).toHaveLength(2);
    const ids = ready.map((r) => r.sub_goal_id).sort();
    expect(ids).toEqual(["sg2", "sg3"]);
  });

  it("markFailed cascades skip to dependents", () => {
    const graph = new JobGraph(makeGraph());
    graph.markFailed("sg1", "Error occurred");

    const data = graph.toJSON();
    const sg2 = data.sub_goals.find((sg) => sg.sub_goal_id === "sg2")!;
    const sg3 = data.sub_goals.find((sg) => sg.sub_goal_id === "sg3")!;
    expect(sg2.status).toBe("skipped");
    expect(sg3.status).toBe("skipped");
  });

  it("isComplete returns true when all terminal", () => {
    const graph = new JobGraph(makeGraph());
    expect(graph.isComplete()).toBe(false);

    graph.markCompleted("sg1", "Done");
    expect(graph.isComplete()).toBe(false);

    graph.markCompleted("sg2", "Done");
    graph.markCompleted("sg3", "Done");
    expect(graph.isComplete()).toBe(true);
  });

  it("graph status transitions to completed", () => {
    const graph = new JobGraph(makeGraph());
    graph.markCompleted("sg1", "Done");
    graph.markCompleted("sg2", "Done");
    graph.markCompleted("sg3", "Done");
    expect(graph.status).toBe("completed");
  });

  it("graph status transitions to failed on any failure", () => {
    const graph = new JobGraph(makeGraph());
    graph.markFailed("sg1", "Error");
    expect(graph.status).toBe("failed");
  });

  it("topologicalOrder returns correct ordering", () => {
    const graph = new JobGraph(makeGraph());
    const order = graph.topologicalOrder();
    const ids = order.map((sg) => sg.sub_goal_id);
    // sg1 must come before sg2 and sg3
    expect(ids.indexOf("sg1")).toBeLessThan(ids.indexOf("sg2"));
    expect(ids.indexOf("sg1")).toBeLessThan(ids.indexOf("sg3"));
  });

  it("markRunning sets status and run_id", () => {
    const graph = new JobGraph(makeGraph());
    graph.markRunning("sg1", "run-123");
    const data = graph.toJSON();
    const sg1 = data.sub_goals.find((sg) => sg.sub_goal_id === "sg1")!;
    expect(sg1.status).toBe("running");
    expect(sg1.run_id).toBe("run-123");
  });

  it("cascadeSkip is transitive", () => {
    const graph = new JobGraph(makeGraph({
      sub_goals: [
        { sub_goal_id: "a", parent_goal: "", agent_id: "x", goal: "", depends_on: [], status: "pending" },
        { sub_goal_id: "b", parent_goal: "", agent_id: "x", goal: "", depends_on: ["a"], status: "pending" },
        { sub_goal_id: "c", parent_goal: "", agent_id: "x", goal: "", depends_on: ["b"], status: "pending" },
      ],
    }));

    graph.markFailed("a", "Error");
    const data = graph.toJSON();
    expect(data.sub_goals.find((sg) => sg.sub_goal_id === "b")!.status).toBe("skipped");
    expect(data.sub_goals.find((sg) => sg.sub_goal_id === "c")!.status).toBe("skipped");
  });
});
