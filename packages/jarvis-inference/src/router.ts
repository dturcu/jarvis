import type { TaskProfile, SelectionPolicy } from "./task-profile.js";
import { derivePolicy } from "./task-profile.js";

export type ModelCapability = "chat" | "code" | "vision" | "embedding";

/** Size class of a model, derived from parameter count heuristics. */
export type ModelSizeClass = "small" | "medium" | "large";

export type ModelInfo = {
  id: string;
  runtime: "ollama" | "lmstudio";
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

  if (/vision|llava|bakllava|minicpm-v|moondream/.test(lower)) {
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

export function selectEmbeddingModel(available: ModelInfo[]): ModelInfo | null {
  // Prefer dedicated embedding models first
  const dedicated = available.find((m) => m.capabilities.includes("embedding"));
  if (dedicated) return dedicated;

  // Fall back to any chat model (most can also embed)
  return available[0] ?? null;
}
