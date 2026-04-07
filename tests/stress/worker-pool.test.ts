/**
 * Stress: Worker Pool
 *
 * Tests MockAgentAdapter under concurrent operations:
 * simultaneous starts, burst operations, and interleaved step/status calls.
 */

import { describe, it, expect } from "vitest";
import { MockAgentAdapter } from "@jarvis/agent-worker";
import { range } from "./helpers.js";

describe("Worker Pool Stress", () => {
  it("8 agents started and stepped simultaneously", async () => {
    const adapter = new MockAgentAdapter();
    const agents = [
      "bd-pipeline", "proposal-engine", "evidence-auditor", "contract-reviewer",
      "staffing-monitor", "content-engine", "portfolio-monitor", "garden-calendar",
    ];

    // Start all 8 in parallel
    const startResults = await Promise.all(
      agents.map((agentId) => adapter.start({ agent_id: agentId })),
    );

    expect(startResults).toHaveLength(8);
    const runIds = startResults.map((r) => r.structured_output.run_id);
    expect(new Set(runIds).size).toBe(8); // All unique

    // Step all 8 through 5 steps each (40 operations)
    for (let step = 0; step < 5; step++) {
      const stepResults = await Promise.all(
        runIds.map((runId) => adapter.step({ run_id: runId })),
      );
      expect(stepResults).toHaveLength(8);
    }

    // Verify all runs are now completed
    for (const agentId of agents) {
      const status = await adapter.status({ agent_id: agentId });
      const runs = status.structured_output.runs as Array<{ status: string }>;
      expect(runs.length).toBeGreaterThan(0);
      expect(runs[0].status).toBe("completed");
    }

    expect(adapter.getRunCount()).toBe(8);
  });

  it("50 burst starts for the same agent", async () => {
    const adapter = new MockAgentAdapter();
    const errors: string[] = [];

    const results = await Promise.all(
      range(50).map(async (i) => {
        try {
          const result = await adapter.start({
            agent_id: "bd-pipeline",
            goal: `Burst goal ${i}`,
          });
          return { runId: result.structured_output.run_id, error: null };
        } catch (e) {
          errors.push(String(e));
          return { runId: null, error: String(e) };
        }
      }),
    );

    expect(errors).toHaveLength(0);
    expect(results.filter((r) => r.runId)).toHaveLength(50);

    // All run IDs unique
    const runIds = new Set(results.map((r) => r.runId));
    expect(runIds.size).toBe(50);
    expect(adapter.getRunCount()).toBe(50);
  });

  it("200 interleaved start/step/status operations", async () => {
    const adapter = new MockAgentAdapter();
    const agents = ["bd-pipeline", "proposal-engine", "evidence-auditor", "contract-reviewer"];
    const errors: string[] = [];

    // Start 4 agents first
    const runMap = new Map<string, string>();
    for (const agentId of agents) {
      const result = await adapter.start({ agent_id: agentId });
      runMap.set(agentId, result.structured_output.run_id);
    }

    // Fire 200 interleaved operations
    await Promise.all(
      range(200).map(async (i) => {
        try {
          const agentId = agents[i % agents.length];
          const op = i % 3;

          if (op === 0) {
            // Start new run
            await adapter.start({ agent_id: agentId, goal: `Interleaved ${i}` });
          } else if (op === 1) {
            // Step an existing run
            const runId = runMap.get(agentId);
            if (runId) {
              await adapter.step({ run_id: runId });
            }
          } else {
            // Status check
            await adapter.status({ agent_id: agentId });
          }
        } catch (e) {
          // RUN_NOT_FOUND is expected for completed runs being stepped
          if (!String(e).includes("RUN_NOT_FOUND")) {
            errors.push(`Op ${i}: ${String(e)}`);
          }
        }
      }),
    );

    expect(errors).toHaveLength(0);
    expect(adapter.getRunCount()).toBeGreaterThan(4);
  });

  it("pause and resume under load", async () => {
    const adapter = new MockAgentAdapter();
    const errors: string[] = [];

    // Start 10 runs
    const runIds: string[] = [];
    for (let i = 0; i < 10; i++) {
      const agentId = i < 8
        ? ["bd-pipeline", "proposal-engine", "evidence-auditor", "contract-reviewer",
           "staffing-monitor", "content-engine", "portfolio-monitor", "garden-calendar"][i]
        : `bd-pipeline`; // reuse for extras
      const result = await adapter.start({ agent_id: agentId, goal: `Pause test ${i}` });
      runIds.push(result.structured_output.run_id);
    }

    // Pause all concurrently
    await Promise.all(
      runIds.map(async (runId) => {
        try {
          await adapter.pause({ run_id: runId });
        } catch (e) {
          errors.push(String(e));
        }
      }),
    );
    expect(errors).toHaveLength(0);

    // Resume all concurrently
    await Promise.all(
      runIds.map(async (runId) => {
        try {
          await adapter.resume({ run_id: runId });
        } catch (e) {
          errors.push(String(e));
        }
      }),
    );
    expect(errors).toHaveLength(0);
  });

  it("configure multiple agents concurrently", async () => {
    const adapter = new MockAgentAdapter();
    const agents = ["bd-pipeline", "proposal-engine", "evidence-auditor", "contract-reviewer"];

    await Promise.all(
      agents.map(async (agentId, i) => {
        await adapter.configure({
          agent_id: agentId,
          updates: { max_steps: 10 + i, timeout: 30_000, priority: i },
        });
      }),
    );

    // Verify configs applied
    for (let i = 0; i < agents.length; i++) {
      const config = adapter.getConfiguration(agents[i]);
      expect(config).toBeDefined();
      expect(config!.max_steps).toBe(10 + i);
      expect(config!.priority).toBe(i);
    }
  });
});
