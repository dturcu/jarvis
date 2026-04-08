/**
 * Unit tests for InferenceGovernor (Epic 6).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { InferenceGovernor, type InferenceGovernancePolicy } from "@jarvis/inference";

describe("InferenceGovernor", () => {
  let governor: InferenceGovernor;

  beforeEach(() => {
    governor = new InferenceGovernor({
      max_daily_cost_usd: 10.0,
      min_local_percentage: 0.8,
      fallback_policy: "reject",
    });
  });

  it("allows requests within budget", () => {
    const result = governor.checkRequest("ollama", 0.5);
    expect(result.allowed).toBe(true);
  });

  it("rejects requests exceeding daily budget", () => {
    // Record usage that nearly exhausts the budget
    governor.recordUsage({
      timestamp: new Date().toISOString(),
      model: "test-model",
      runtime: "openclaw",
      tokens_used: 10000,
      latency_ms: 500,
      estimated_cost_usd: 9.8,
    });

    const result = governor.checkRequest("openclaw", 0.5);
    expect(result.allowed).toBe(false);
    expect(result.applied_policy).toBe("max_daily_cost_usd");
  });

  it("tracks daily cost correctly", () => {
    governor.recordUsage({
      timestamp: new Date().toISOString(),
      model: "model-a",
      runtime: "ollama",
      tokens_used: 1000,
      latency_ms: 200,
      estimated_cost_usd: 1.5,
    });
    governor.recordUsage({
      timestamp: new Date().toISOString(),
      model: "model-b",
      runtime: "lmstudio",
      tokens_used: 2000,
      latency_ms: 300,
      estimated_cost_usd: 2.5,
    });

    const state = governor.getState();
    expect(state.daily_cost_usd).toBe(4.0);
    expect(state.total_requests).toBe(2);
    expect(state.local_percentage).toBe(1.0); // both local
  });

  it("tracks local percentage", () => {
    // Record 8 local + 2 cloud = 80% local
    for (let i = 0; i < 8; i++) {
      governor.recordUsage({
        timestamp: new Date().toISOString(),
        model: `local-${i}`,
        runtime: "ollama",
        tokens_used: 100,
        latency_ms: 100,
        estimated_cost_usd: 0,
      });
    }
    for (let i = 0; i < 2; i++) {
      governor.recordUsage({
        timestamp: new Date().toISOString(),
        model: `cloud-${i}`,
        runtime: "openclaw",
        tokens_used: 100,
        latency_ms: 100,
        estimated_cost_usd: 0.1,
      });
    }

    const state = governor.getState();
    expect(state.local_percentage).toBe(0.8);
    expect(state.total_requests).toBe(10);
  });

  it("rejects when local percentage drops below minimum", () => {
    // Need >10 requests for the check to activate
    for (let i = 0; i < 11; i++) {
      governor.recordUsage({
        timestamp: new Date().toISOString(),
        model: `cloud-${i}`,
        runtime: "openclaw",
        tokens_used: 100,
        latency_ms: 100,
        estimated_cost_usd: 0.01,
      });
    }

    // local_percentage is now 0% < 80%
    const result = governor.checkRequest("openclaw", 0.01);
    expect(result.allowed).toBe(false);
    expect(result.applied_policy).toBe("min_local_percentage");
  });

  it("allows local requests even when local percentage is low", () => {
    for (let i = 0; i < 11; i++) {
      governor.recordUsage({
        timestamp: new Date().toISOString(),
        model: `cloud-${i}`,
        runtime: "openclaw",
        tokens_used: 100,
        latency_ms: 100,
        estimated_cost_usd: 0.01,
      });
    }

    // Local requests are always allowed (the check only blocks non-local)
    const result = governor.checkRequest("ollama", 0);
    expect(result.allowed).toBe(true);
  });

  it("estimates cost correctly with overrides", () => {
    const gov = new InferenceGovernor({
      fallback_policy: "degrade",
      cost_per_token_override: { "gpt-4": 0.03, "gpt-3.5": 0.001 },
    });

    expect(gov.estimateCost("gpt-4", 1000)).toBe(0.03);
    expect(gov.estimateCost("gpt-3.5", 5000)).toBe(0.005);
    expect(gov.estimateCost("unknown-model", 1000)).toBe(0); // no override
  });

  it("reports budget remaining", () => {
    governor.recordUsage({
      timestamp: new Date().toISOString(),
      model: "test",
      runtime: "openclaw",
      tokens_used: 1000,
      latency_ms: 100,
      estimated_cost_usd: 3.5,
    });

    const state = governor.getState();
    expect(state.budget_remaining_usd).toBe(6.5);
  });

  it("returns null budget when no limit set", () => {
    const unlimited = new InferenceGovernor({ fallback_policy: "degrade" });
    const state = unlimited.getState();
    expect(state.budget_remaining_usd).toBeNull();
  });
});
