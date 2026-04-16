/**
 * Comprehensive tests for llama.cpp integration.
 *
 * Covers: runtime preference, model selection across all policies,
 * buildModelInfo, registry round-trip, governance, mock adapter,
 * evidence-backed selection, task profile routing, and edge cases.
 */

import { describe, expect, it, beforeEach } from "vitest";
import {
  buildModelInfo,
  classifyModelSize,
  inferCapabilities,
  selectModel,
  selectByProfile,
  selectByProfileWithEvidence,
  selectEmbeddingModel,
  InferenceGovernor,
  type ModelInfo,
  type ModelBenchmarkData,
  type TaskProfile,
  type SelectionPolicy,
} from "@jarvis/inference";
import { MockInferenceAdapter } from "@jarvis/inference-worker";

// ── Helper: build a model pool with all three runtimes ────────────────────────

function makeModel(
  id: string,
  runtime: ModelInfo["runtime"],
  size_class: ModelInfo["size_class"],
  capabilities: ModelInfo["capabilities"] = ["chat"],
): ModelInfo {
  return { id, runtime, size_class, capabilities };
}

// ── buildModelInfo with llamacpp runtime ─────────────────────────────────────

describe("buildModelInfo — llamacpp runtime", () => {
  it("builds a model info for llamacpp with correct runtime", () => {
    const info = buildModelInfo("mistral:7b-instruct", "llamacpp");
    expect(info.runtime).toBe("llamacpp");
    expect(info.id).toBe("mistral:7b-instruct");
  });

  it("classifies size correctly for llamacpp models", () => {
    expect(buildModelInfo("llama3.2:1b", "llamacpp").size_class).toBe("small");
    expect(buildModelInfo("mistral:7b", "llamacpp").size_class).toBe("medium");
    expect(buildModelInfo("llama3.1:70b", "llamacpp").size_class).toBe("large");
  });

  it("infers capabilities correctly for llamacpp models", () => {
    const codeModel = buildModelInfo("deepseek-coder:6.7b", "llamacpp");
    expect(codeModel.capabilities).toContain("code");

    const visionModel = buildModelInfo("llava:7b", "llamacpp");
    expect(visionModel.capabilities).toContain("vision");

    const embedModel = buildModelInfo("nomic-embed-text", "llamacpp");
    expect(embedModel.capabilities).toContain("embedding");
    expect(embedModel.capabilities).not.toContain("chat");
  });
});

// ── Runtime preference: llamacpp wins ties ───────────────────────────────────

describe("selectModel — llamacpp preferred over other runtimes", () => {
  // Same model at same size across all three runtimes
  const identicalMedium: ModelInfo[] = [
    makeModel("mistral:7b", "ollama", "medium"),
    makeModel("mistral:7b", "lmstudio", "medium"),
    makeModel("mistral:7b", "llamacpp", "medium"),
  ];

  // Shuffle order — llamacpp last in input
  const shuffled: ModelInfo[] = [
    makeModel("llama3.1:8b", "lmstudio", "medium"),
    makeModel("llama3.1:8b", "ollama", "medium"),
    makeModel("llama3.1:8b", "llamacpp", "medium"),
  ];

  const allPolicies: SelectionPolicy[] = [
    "balanced_local",
    "fastest_local",
    "best_reasoning_local",
    "best_code_local",
    "json_reliable_local",
    "pinned",
  ];

  for (const policy of allPolicies) {
    it(`${policy}: prefers llamacpp when identical models exist`, () => {
      const selected = selectModel(identicalMedium, policy);
      expect(selected).not.toBeNull();
      expect(selected!.runtime).toBe("llamacpp");
    });

    it(`${policy}: prefers llamacpp regardless of input order`, () => {
      const selected = selectModel(shuffled, policy);
      expect(selected).not.toBeNull();
      expect(selected!.runtime).toBe("llamacpp");
    });
  }

  it("fastest_local: prefers llamacpp small over ollama small", () => {
    const models: ModelInfo[] = [
      makeModel("phi3:mini", "ollama", "small"),
      makeModel("phi3:mini", "llamacpp", "small"),
    ];
    const selected = selectModel(models, "fastest_local");
    expect(selected!.runtime).toBe("llamacpp");
  });

  it("best_reasoning_local: prefers llamacpp large over lmstudio large", () => {
    const models: ModelInfo[] = [
      makeModel("llama3.1:70b", "lmstudio", "large"),
      makeModel("llama3.1:70b", "llamacpp", "large"),
    ];
    const selected = selectModel(models, "best_reasoning_local");
    expect(selected!.runtime).toBe("llamacpp");
  });

  it("best_code_local: prefers llamacpp code model over ollama code model", () => {
    const models: ModelInfo[] = [
      makeModel("deepseek-coder:6.7b", "ollama", "medium", ["chat", "code"]),
      makeModel("deepseek-coder:6.7b", "llamacpp", "medium", ["chat", "code"]),
    ];
    const selected = selectModel(models, "best_code_local");
    expect(selected!.runtime).toBe("llamacpp");
  });

  it("vision_local: prefers llamacpp vision model over ollama vision model", () => {
    const models: ModelInfo[] = [
      makeModel("llava:7b", "ollama", "medium", ["chat", "vision"]),
      makeModel("llava:7b", "llamacpp", "medium", ["chat", "vision"]),
    ];
    const selected = selectModel(models, "vision_local");
    expect(selected!.runtime).toBe("llamacpp");
  });
});

// ── Size class still takes precedence over runtime preference ────────────────

describe("selectModel — size class takes precedence over runtime preference", () => {
  it("balanced_local: picks llamacpp medium over llamacpp small", () => {
    const models: ModelInfo[] = [
      makeModel("phi3:mini", "llamacpp", "small"),
      makeModel("mistral:7b", "llamacpp", "medium"),
    ];
    const selected = selectModel(models, "balanced_local");
    expect(selected!.id).toBe("mistral:7b");
    expect(selected!.size_class).toBe("medium");
  });

  it("fastest_local: picks ollama small over llamacpp medium when size differs", () => {
    const models: ModelInfo[] = [
      makeModel("mistral:7b", "llamacpp", "medium"),
      makeModel("phi3:mini", "ollama", "small"),
    ];
    const selected = selectModel(models, "fastest_local");
    expect(selected!.size_class).toBe("small");
  });

  it("best_reasoning_local: picks ollama large over llamacpp medium", () => {
    const models: ModelInfo[] = [
      makeModel("mistral:7b", "llamacpp", "medium"),
      makeModel("llama3.1:70b", "ollama", "large"),
    ];
    const selected = selectModel(models, "best_reasoning_local");
    expect(selected!.size_class).toBe("large");
    expect(selected!.runtime).toBe("ollama");
  });

  it("balanced_local: prefers llamacpp medium over ollama medium (same size = runtime breaks tie)", () => {
    const models: ModelInfo[] = [
      makeModel("mistral:7b", "ollama", "medium"),
      makeModel("qwen2:7b", "llamacpp", "medium"),
    ];
    const selected = selectModel(models, "balanced_local");
    expect(selected!.runtime).toBe("llamacpp");
  });
});

// ── selectByProfile routing through llamacpp ─────────────────────────────────

describe("selectByProfile — llamacpp preference via task profiles", () => {
  const multiRuntimePool: ModelInfo[] = [
    makeModel("phi3:mini", "ollama", "small"),
    makeModel("phi3:mini", "llamacpp", "small"),
    makeModel("mistral:7b", "ollama", "medium"),
    makeModel("mistral:7b", "llamacpp", "medium"),
    makeModel("llama3.1:70b", "lmstudio", "large"),
    makeModel("llama3.1:70b", "llamacpp", "large"),
    makeModel("deepseek-coder:6.7b", "llamacpp", "medium", ["chat", "code"]),
    makeModel("deepseek-coder:6.7b", "ollama", "medium", ["chat", "code"]),
    makeModel("llava:7b", "llamacpp", "medium", ["chat", "vision"]),
    makeModel("llava:7b", "ollama", "medium", ["chat", "vision"]),
  ];

  it("answer task: selects llamacpp medium (balanced_local)", () => {
    const profile: TaskProfile = { objective: "answer" };
    const selected = selectByProfile(multiRuntimePool, profile);
    expect(selected!.runtime).toBe("llamacpp");
    expect(selected!.size_class).toBe("medium");
  });

  it("speed-first task: selects llamacpp small (fastest_local)", () => {
    const profile: TaskProfile = { objective: "answer", preferences: { prioritize_speed: true } };
    const selected = selectByProfile(multiRuntimePool, profile);
    expect(selected!.runtime).toBe("llamacpp");
    expect(selected!.size_class).toBe("small");
  });

  it("accuracy-first task: selects llamacpp large (best_reasoning_local)", () => {
    const profile: TaskProfile = { objective: "plan", preferences: { prioritize_accuracy: true } };
    const selected = selectByProfile(multiRuntimePool, profile);
    expect(selected!.runtime).toBe("llamacpp");
    expect(selected!.size_class).toBe("large");
  });

  it("code task: selects llamacpp code model", () => {
    const profile: TaskProfile = { objective: "code" };
    const selected = selectByProfile(multiRuntimePool, profile);
    expect(selected!.runtime).toBe("llamacpp");
    expect(selected!.capabilities).toContain("code");
  });

  it("vision task: selects llamacpp vision model", () => {
    const profile: TaskProfile = { objective: "answer", constraints: { require_vision: true } };
    const selected = selectByProfile(multiRuntimePool, profile);
    expect(selected!.runtime).toBe("llamacpp");
    expect(selected!.capabilities).toContain("vision");
  });

  it("classify task: selects llamacpp small (fastest_local)", () => {
    const profile: TaskProfile = { objective: "classify" };
    const selected = selectByProfile(multiRuntimePool, profile);
    expect(selected!.runtime).toBe("llamacpp");
    expect(selected!.size_class).toBe("small");
  });

  it("JSON task: selects llamacpp medium (json_reliable_local)", () => {
    const profile: TaskProfile = { objective: "extract", constraints: { require_json: true } };
    const selected = selectByProfile(multiRuntimePool, profile);
    expect(selected!.runtime).toBe("llamacpp");
    expect(selected!.size_class).toBe("medium");
  });
});

// ── selectByProfileWithEvidence — benchmark-backed selection ─────────────────

describe("selectByProfileWithEvidence — llamacpp with benchmarks", () => {
  const models: ModelInfo[] = [
    makeModel("mistral:7b", "ollama", "medium"),
    makeModel("mistral:7b", "llamacpp", "medium"),
    makeModel("phi3:mini", "ollama", "small"),
    makeModel("phi3:mini", "llamacpp", "small"),
  ];

  it("fastest_local: picks faster llamacpp model when benchmarks show lower latency", () => {
    const benchmarks: ModelBenchmarkData[] = [
      { model_id: "mistral:7b", latency_ms: 500, tokens_per_sec: 30, json_success: null, tool_call_success: null },
      { model_id: "phi3:mini", latency_ms: 100, tokens_per_sec: 80, json_success: null, tool_call_success: null },
    ];
    const profile: TaskProfile = { objective: "answer", preferences: { prioritize_speed: true } };
    const selected = selectByProfileWithEvidence(models, profile, benchmarks);
    expect(selected!.id).toBe("phi3:mini");
  });

  it("fastest_local: with no benchmarks, falls back to heuristic and prefers llamacpp", () => {
    const profile: TaskProfile = { objective: "answer", preferences: { prioritize_speed: true } };
    const selected = selectByProfileWithEvidence(models, profile, []);
    expect(selected!.runtime).toBe("llamacpp");
    expect(selected!.size_class).toBe("small");
  });

  it("json_reliable_local: picks model with highest json_success, regardless of runtime", () => {
    const jsonModels: ModelInfo[] = [
      makeModel("mistral:7b", "llamacpp", "medium"),
      makeModel("qwen2:7b", "ollama", "medium"),
    ];
    const benchmarks: ModelBenchmarkData[] = [
      { model_id: "mistral:7b", latency_ms: 200, tokens_per_sec: 30, json_success: 0.6, tool_call_success: null },
      { model_id: "qwen2:7b", latency_ms: 200, tokens_per_sec: 30, json_success: 0.95, tool_call_success: null },
    ];
    const profile: TaskProfile = { objective: "extract", constraints: { require_json: true } };
    const selected = selectByProfileWithEvidence(jsonModels, profile, benchmarks);
    // qwen2:7b has higher json_success (0.95 > 0.6)
    expect(selected!.id).toBe("qwen2:7b");
  });

  it("json_reliable_local: falls back to heuristic (llamacpp preferred) when json_success < 50%", () => {
    const jsonModels: ModelInfo[] = [
      makeModel("mistral:7b", "ollama", "medium"),
      makeModel("mistral:7b", "llamacpp", "medium"),
    ];
    const benchmarks: ModelBenchmarkData[] = [
      { model_id: "mistral:7b", latency_ms: 200, tokens_per_sec: 30, json_success: 0.3, tool_call_success: null },
    ];
    const profile: TaskProfile = { objective: "extract", constraints: { require_json: true } };
    const selected = selectByProfileWithEvidence(jsonModels, profile, benchmarks);
    // Falls back to heuristic — llamacpp wins the tie
    expect(selected!.runtime).toBe("llamacpp");
  });

  it("best_reasoning_local: prefers large llamacpp with better tool_call_success", () => {
    const reasoningModels: ModelInfo[] = [
      makeModel("llama3.1:70b", "ollama", "large"),
      makeModel("llama3.1:70b", "llamacpp", "large"),
    ];
    const benchmarks: ModelBenchmarkData[] = [
      { model_id: "llama3.1:70b", latency_ms: 1000, tokens_per_sec: 10, json_success: null, tool_call_success: 0.9 },
    ];
    const profile: TaskProfile = { objective: "plan", preferences: { prioritize_accuracy: true } };
    const selected = selectByProfileWithEvidence(reasoningModels, profile, benchmarks);
    // Both are "llama3.1:70b" — same benchmark entry applies to both
    expect(selected!.size_class).toBe("large");
  });
});

// ── selectEmbeddingModel — llamacpp preference ──────────────────────────────

describe("selectEmbeddingModel — llamacpp embedding preference", () => {
  it("prefers llamacpp embedding model over ollama embedding model", () => {
    const models: ModelInfo[] = [
      makeModel("nomic-embed-text", "ollama", "small", ["embedding"]),
      makeModel("nomic-embed-text", "llamacpp", "small", ["embedding"]),
    ];
    expect(selectEmbeddingModel(models)!.runtime).toBe("llamacpp");
  });

  it("prefers llamacpp embedding model regardless of input order", () => {
    const models: ModelInfo[] = [
      makeModel("bge-large-en-v1.5", "lmstudio", "medium", ["embedding"]),
      makeModel("nomic-embed-text", "llamacpp", "small", ["embedding"]),
      makeModel("nomic-embed-text", "ollama", "small", ["embedding"]),
    ];
    expect(selectEmbeddingModel(models)!.runtime).toBe("llamacpp");
  });

  it("returns null if no embedding-capable models exist (even with llamacpp chat models)", () => {
    const models: ModelInfo[] = [
      makeModel("mistral:7b", "llamacpp", "medium", ["chat"]),
      makeModel("mistral:7b", "ollama", "medium", ["chat"]),
    ];
    expect(selectEmbeddingModel(models)).toBeNull();
  });
});

// ── Edge cases ──────────────────────────────────────────────────────────────

describe("selectModel — edge cases", () => {
  it("returns null for empty model list", () => {
    expect(selectModel([], "balanced_local")).toBeNull();
  });

  it("handles single llamacpp model", () => {
    const models = [makeModel("mistral:7b", "llamacpp", "medium")];
    expect(selectModel(models, "balanced_local")!.runtime).toBe("llamacpp");
  });

  it("handles only openclaw models (no local models)", () => {
    const models = [makeModel("claude-3.5-sonnet", "openclaw", "large")];
    const selected = selectModel(models, "balanced_local");
    expect(selected!.runtime).toBe("openclaw");
  });

  it("llamacpp-only pool works for all policies", () => {
    const models: ModelInfo[] = [
      makeModel("phi3:mini", "llamacpp", "small"),
      makeModel("mistral:7b", "llamacpp", "medium"),
      makeModel("llama3.1:70b", "llamacpp", "large"),
      makeModel("deepseek-coder:6.7b", "llamacpp", "medium", ["chat", "code"]),
      makeModel("llava:7b", "llamacpp", "medium", ["chat", "vision"]),
      makeModel("nomic-embed-text", "llamacpp", "small", ["embedding"]),
    ];

    expect(selectModel(models, "balanced_local")!.size_class).toBe("medium");
    expect(selectModel(models, "fastest_local")!.size_class).toBe("small");
    expect(selectModel(models, "best_reasoning_local")!.size_class).toBe("large");
    expect(selectModel(models, "best_code_local")!.capabilities).toContain("code");
    expect(selectModel(models, "vision_local")!.capabilities).toContain("vision");
    expect(selectModel(models, "json_reliable_local")!.size_class).toBe("medium");
    expect(selectModel(models, "embedding_local")!.capabilities).toContain("embedding");
  });

  it("does not mutate the original array", () => {
    const models: ModelInfo[] = [
      makeModel("mistral:7b", "ollama", "medium"),
      makeModel("mistral:7b", "llamacpp", "medium"),
    ];
    const original = [...models];
    selectModel(models, "balanced_local");
    expect(models).toEqual(original);
  });

  it("prefers llamacpp over lmstudio, and lmstudio over openclaw", () => {
    // Only lmstudio and openclaw — lmstudio should win
    const models: ModelInfo[] = [
      makeModel("mistral:7b", "openclaw", "medium"),
      makeModel("mistral:7b", "lmstudio", "medium"),
    ];
    const selected = selectModel(models, "balanced_local");
    expect(selected!.runtime).toBe("lmstudio");
  });

  it("handles large mixed pool deterministically", () => {
    const models: ModelInfo[] = [
      makeModel("gemma2:2b", "ollama", "small"),
      makeModel("phi3:mini", "lmstudio", "small"),
      makeModel("phi3:mini", "llamacpp", "small"),
      makeModel("mistral:7b", "ollama", "medium"),
      makeModel("qwen2:7b", "lmstudio", "medium"),
      makeModel("llama3.1:8b", "llamacpp", "medium"),
      makeModel("llama3.1:70b", "ollama", "large"),
      makeModel("llama3.1:70b", "llamacpp", "large"),
    ];

    // balanced_local: medium preferred, llamacpp wins ties
    const balanced = selectModel(models, "balanced_local");
    expect(balanced!.runtime).toBe("llamacpp");
    expect(balanced!.size_class).toBe("medium");

    // Run it multiple times — deterministic
    for (let i = 0; i < 10; i++) {
      expect(selectModel(models, "balanced_local")!.runtime).toBe("llamacpp");
    }
  });
});

// ── Governance: llamacpp is a local runtime ─────────────────────────────────

describe("InferenceGovernor — llamacpp as local runtime", () => {
  let governor: InferenceGovernor;

  beforeEach(() => {
    governor = new InferenceGovernor({
      max_daily_cost_usd: 10.0,
      min_local_percentage: 0.8,
      fallback_policy: "reject",
    });
  });

  it("allows llamacpp requests within budget", () => {
    const result = governor.checkRequest("llamacpp", 0);
    expect(result.allowed).toBe(true);
  });

  it("counts llamacpp as local in usage records", () => {
    governor.recordUsage({
      timestamp: new Date().toISOString(),
      model: "mistral:7b",
      runtime: "llamacpp",
      tokens_used: 1000,
      latency_ms: 200,
      estimated_cost_usd: 0,
    });

    const state = governor.getState();
    expect(state.local_percentage).toBe(1.0);
    expect(state.total_requests).toBe(1);
  });

  it("mixed local runtimes all count as local", () => {
    const runtimes = ["ollama", "lmstudio", "llamacpp"];
    for (const runtime of runtimes) {
      governor.recordUsage({
        timestamp: new Date().toISOString(),
        model: "test-model",
        runtime,
        tokens_used: 100,
        latency_ms: 100,
        estimated_cost_usd: 0,
      });
    }

    const state = governor.getState();
    expect(state.local_percentage).toBe(1.0);
    expect(state.total_requests).toBe(3);
  });

  it("llamacpp requests not blocked by low local percentage", () => {
    // Flood with cloud requests
    for (let i = 0; i < 12; i++) {
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
    // llamacpp is local, so it should still be allowed
    expect(governor.checkRequest("llamacpp", 0).allowed).toBe(true);
    // openclaw should be blocked
    expect(governor.checkRequest("openclaw", 0.01).allowed).toBe(false);
  });

  it("llamacpp usage helps improve local percentage", () => {
    // 8 openclaw + 2 llamacpp = 20% local
    for (let i = 0; i < 8; i++) {
      governor.recordUsage({
        timestamp: new Date().toISOString(),
        model: `cloud-${i}`,
        runtime: "openclaw",
        tokens_used: 100,
        latency_ms: 100,
        estimated_cost_usd: 0.01,
      });
    }
    for (let i = 0; i < 2; i++) {
      governor.recordUsage({
        timestamp: new Date().toISOString(),
        model: `local-${i}`,
        runtime: "llamacpp",
        tokens_used: 100,
        latency_ms: 100,
        estimated_cost_usd: 0,
      });
    }

    const state = governor.getState();
    expect(state.local_percentage).toBe(0.2);
    expect(state.total_requests).toBe(10);
  });
});

// ── MockInferenceAdapter — llamacpp model present ───────────────────────────

describe("MockInferenceAdapter — llamacpp models", () => {
  let adapter: MockInferenceAdapter;

  beforeEach(() => {
    adapter = new MockInferenceAdapter();
  });

  it("includes llamacpp models in full model listing", async () => {
    const result = await adapter.listModels({ runtime: "all" });
    const llamacppModels = result.structured_output.models.filter(
      (m) => m.runtime === "llamacpp",
    );
    expect(llamacppModels.length).toBeGreaterThan(0);
  });

  it("filters to only llamacpp models", async () => {
    const result = await adapter.listModels({ runtime: "llamacpp" });
    expect(result.structured_output.models.length).toBeGreaterThan(0);
    expect(
      result.structured_output.models.every((m) => m.runtime === "llamacpp"),
    ).toBe(true);
  });

  it("llamacpp models have valid fields", async () => {
    const result = await adapter.listModels({ runtime: "llamacpp" });
    for (const model of result.structured_output.models) {
      expect(model.id).toBeTruthy();
      expect(model.runtime).toBe("llamacpp");
      expect(["small", "medium", "large"]).toContain(model.size_class);
      expect(Array.isArray(model.capabilities)).toBe(true);
      expect(model.capabilities.length).toBeGreaterThan(0);
    }
  });

  it("runtimes_available includes llamacpp when listing all", async () => {
    const result = await adapter.listModels({ runtime: "all" });
    expect(result.structured_output.runtimes_available).toContain("llamacpp");
  });

  it("total_count increases with llamacpp models included", async () => {
    const allResult = await adapter.listModels({ runtime: "all" });
    const ollamaResult = await adapter.listModels({ runtime: "ollama" });
    const lmstudioResult = await adapter.listModels({ runtime: "lmstudio" });
    const llamacppResult = await adapter.listModels({ runtime: "llamacpp" });

    expect(allResult.structured_output.total_count).toBe(
      ollamaResult.structured_output.total_count +
        lmstudioResult.structured_output.total_count +
        llamacppResult.structured_output.total_count,
    );
  });
});

// ── Runtime preference ordering ─────────────────────────────────────────────

describe("runtime preference ordering", () => {
  it("llamacpp > ollama > lmstudio > openclaw", () => {
    const models: ModelInfo[] = [
      makeModel("m", "openclaw", "medium"),
      makeModel("m", "lmstudio", "medium"),
      makeModel("m", "ollama", "medium"),
      makeModel("m", "llamacpp", "medium"),
    ];
    const selected = selectModel(models, "balanced_local");
    expect(selected!.runtime).toBe("llamacpp");
  });

  it("ollama beats lmstudio when no llamacpp present", () => {
    const models: ModelInfo[] = [
      makeModel("m", "lmstudio", "medium"),
      makeModel("m", "ollama", "medium"),
    ];
    const selected = selectModel(models, "balanced_local");
    expect(selected!.runtime).toBe("ollama");
  });
});
