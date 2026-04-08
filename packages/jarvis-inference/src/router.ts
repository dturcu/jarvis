import type { TaskProfile, SelectionPolicy } from "./task-profile.js";
import { derivePolicy } from "./task-profile.js";

export type ModelCapability = "chat" | "code" | "vision" | "embedding";

/** Size class of a model, derived from parameter count heuristics. */
export type ModelSizeClass = "small" | "medium" | "large";

export type ModelInfo = {
  id: string;
  runtime: "ollama" | "lmstudio" | "openclaw";
  size_class: ModelSizeClass;
  capabilities: ModelCapability[];
  parameterCount?: string;
};

export function classifyModelSize(modelId: string): ModelSizeClass {
  const lower = modelId.toLowerCase();

  // Explicit large patterns: 70B+ models (check before small to avoid 70b prefix matching 7b)
  if (/(?:^|[^0-9])(?:34b|40b|70b|72b|110b)(?:[^0-9]|$)|(?:^|[:-])(?:large|xl)(?:[:-]|$)/.test(lower)) {
    return "large";
  }

  // Explicit small patterns: sub-7B models (use word/delimiter boundaries)
  if (/(?:^|[^0-9])(?:1b|2b|3b|1\.5b)(?:[^0-9]|$)|(?:^|[:-])(?:small|tiny|mini)(?:[:-]|$)/.test(lower)) {
    return "small";
  }

  // Default medium (7B-30B)
  return "medium";
}

export function inferCapabilities(modelId: string): ModelCapability[] {
  const lower = modelId.toLowerCase();
  const caps: ModelCapability[] = ["chat"];

  if (/code|coder|starcoder|deepseek-coder|codellama/.test(lower)) {
    caps.push("code");
  }

  if (/vision|llava|bakllava|minicpm-v|moondream|gemma-[34]|gemma3|gemma4/.test(lower)) {
    caps.push("vision");
  }

  if (/embed|embedding|nomic-embed|bge/.test(lower)) {
    // Replace chat with embedding for dedicated embedding models
    const chatIdx = caps.indexOf("chat");
    if (chatIdx !== -1) caps.splice(chatIdx, 1);
    caps.push("embedding");
  }

  return caps;
}

export function buildModelInfo(
  id: string,
  runtime: "ollama" | "lmstudio",
): ModelInfo {
  return {
    id,
    runtime,
    size_class: classifyModelSize(id),
    capabilities: inferCapabilities(id)
  };
}

/**
 * Select a model based on a SelectionPolicy.
 * Maps policy to size preference and capability requirements.
 */
export function selectModel(
  available: ModelInfo[],
  policy: SelectionPolicy,
): ModelInfo | null {
  if (available.length === 0) {
    return null;
  }

  const chatModels = available.filter((m) => m.capabilities.includes("chat"));

  switch (policy) {
    case "fastest_local": {
      // Prefer smallest model
      const small = chatModels.find((m) => m.size_class === "small");
      if (small) return small;
      const medium = chatModels.find((m) => m.size_class === "medium");
      if (medium) return medium;
      return chatModels[0] ?? available[0] ?? null;
    }
    case "best_reasoning_local": {
      // Prefer largest model
      const large = chatModels.find((m) => m.size_class === "large");
      if (large) return large;
      const medium = chatModels.find((m) => m.size_class === "medium");
      if (medium) return medium;
      return chatModels[0] ?? available[0] ?? null;
    }
    case "best_code_local": {
      // Prefer code-specialized, then largest
      const codeModel = chatModels.find((m) => m.capabilities.includes("code"));
      if (codeModel) return codeModel;
      const large = chatModels.find((m) => m.size_class === "large");
      if (large) return large;
      return chatModels[0] ?? available[0] ?? null;
    }
    case "vision_local": {
      const visionModel = available.find((m) => m.capabilities.includes("vision"));
      if (visionModel) return visionModel;
      return chatModels[0] ?? available[0] ?? null;
    }
    case "json_reliable_local": {
      // Prefer medium or larger models (better at structured output)
      const medium = chatModels.find((m) => m.size_class === "medium");
      if (medium) return medium;
      const large = chatModels.find((m) => m.size_class === "large");
      if (large) return large;
      return chatModels[0] ?? available[0] ?? null;
    }
    case "embedding_local": {
      return selectEmbeddingModel(available);
    }
    case "pinned":
    case "balanced_local":
    default: {
      // Prefer medium models (7-13B), balanced performance
      const medium = chatModels.find((m) => m.size_class === "medium");
      if (medium) return medium;
      const small = chatModels.find((m) => m.size_class === "small");
      if (small) return small;
      return chatModels[0] ?? available[0] ?? null;
    }
  }
}

/**
 * Select a model based on a TaskProfile.
 * Derives a SelectionPolicy from the profile, then delegates to selectModel.
 */
export function selectByProfile(
  available: ModelInfo[],
  profile: TaskProfile,
): ModelInfo | null {
  const policy = derivePolicy(profile);
  return selectModel(available, policy);
}

/**
 * Evidence-backed model selection.
 *
 * Consults benchmark data when available to make better-informed decisions.
 * Falls back to heuristic selection when no benchmarks exist.
 */
export type ModelBenchmarkData = {
  model_id: string;
  latency_ms: number;
  tokens_per_sec: number | null;
  json_success: number | null;
  tool_call_success: number | null;
};

export function selectByProfileWithEvidence(
  available: ModelInfo[],
  profile: TaskProfile,
  benchmarks: ModelBenchmarkData[],
): ModelInfo | null {
  if (available.length === 0) return null;
  if (benchmarks.length === 0) return selectByProfile(available, profile);

  const policy = derivePolicy(profile);
  const chatModels = available.filter(m => m.capabilities.includes("chat"));
  if (chatModels.length === 0) return available[0] ?? null;

  // Build a benchmark lookup
  const benchMap = new Map<string, ModelBenchmarkData>();
  for (const b of benchmarks) {
    // Keep the one with the most data
    const existing = benchMap.get(b.model_id);
    if (!existing) {
      benchMap.set(b.model_id, b);
    }
  }

  switch (policy) {
    case "fastest_local": {
      // Sort by latency (lowest first), prefer benchmarked models
      const sorted = [...chatModels].sort((a, b) => {
        const ba = benchMap.get(a.id);
        const bb = benchMap.get(b.id);
        if (ba && bb) return ba.latency_ms - bb.latency_ms;
        if (ba) return -1; // prefer benchmarked
        if (bb) return 1;
        // Fall back to size class
        const sizeOrder = { small: 0, medium: 1, large: 2 };
        return sizeOrder[a.size_class] - sizeOrder[b.size_class];
      });
      return sorted[0] ?? null;
    }

    case "best_reasoning_local": {
      // Prefer largest with good tool call success
      const sorted = [...chatModels].sort((a, b) => {
        const sizeOrder = { small: 0, medium: 1, large: 2 };
        const sizeDiff = sizeOrder[b.size_class] - sizeOrder[a.size_class];
        if (sizeDiff !== 0) return sizeDiff;
        // Among same size, prefer higher tool call success
        const ba = benchMap.get(a.id);
        const bb = benchMap.get(b.id);
        const ta = ba?.tool_call_success ?? 0;
        const tb = bb?.tool_call_success ?? 0;
        return tb - ta;
      });
      return sorted[0] ?? null;
    }

    case "json_reliable_local": {
      // Prefer models with proven JSON output
      const withBench = chatModels
        .map(m => ({ model: m, bench: benchMap.get(m.id) }))
        .filter(x => x.bench?.json_success !== null && x.bench?.json_success !== undefined);

      if (withBench.length > 0) {
        withBench.sort((a, b) => (b.bench!.json_success ?? 0) - (a.bench!.json_success ?? 0));
        // Pick the best JSON success rate, but only if > 50%
        if ((withBench[0]!.bench!.json_success ?? 0) > 0.5) {
          return withBench[0]!.model;
        }
      }
      // Fall back to heuristic
      return selectModel(available, policy);
    }

    default:
      return selectModel(available, policy);
  }
}

export function selectEmbeddingModel(available: ModelInfo[]): ModelInfo | null {
  // Prefer dedicated embedding models first
  const dedicated = available.find((m) => m.capabilities.includes("embedding"));
  if (dedicated) return dedicated;

  // Fall back to any chat model (most can also embed)
  return available[0] ?? null;
}
