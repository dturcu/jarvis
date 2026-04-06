export type ModelTier = "haiku" | "sonnet" | "opus";

export type ModelCapability = "chat" | "code" | "vision" | "embedding";

export type ModelInfo = {
  id: string;
  runtime: "ollama" | "lmstudio";
  tier: ModelTier;
  capabilities: ModelCapability[];
  parameterCount?: string;
};

export function classifyModelTier(modelId: string): ModelTier {
  const lower = modelId.toLowerCase();

  // Explicit large patterns: 70B+ models (check before small to avoid 70b prefix matching 7b)
  if (/(?:^|[^0-9])(?:70b|72b|110b)(?:[^0-9]|$)|(?:^|[:-])(?:large|xl)(?:[:-]|$)/.test(lower)) {
    return "opus";
  }

  // Explicit small patterns: sub-7B models (use word/delimiter boundaries)
  if (/(?:^|[^0-9])(?:1b|2b|3b|1\.5b)(?:[^0-9]|$)|(?:^|[:-])(?:small|tiny|mini)(?:[:-]|$)/.test(lower)) {
    return "haiku";
  }

  // Default medium tier (7B-30B)
  return "sonnet";
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
    tier: classifyModelTier(id),
    capabilities: inferCapabilities(id)
  };
}

const TIER_FALLBACK_ORDER: Record<ModelTier, ModelTier[]> = {
  haiku: ["haiku", "sonnet", "opus"],
  sonnet: ["sonnet", "haiku", "opus"],
  opus: ["opus", "sonnet", "haiku"]
};

export function selectModel(
  available: ModelInfo[],
  requestedTier: ModelTier,
): ModelInfo | null {
  if (available.length === 0) {
    return null;
  }

  const fallbackOrder = TIER_FALLBACK_ORDER[requestedTier];

  for (const tier of fallbackOrder) {
    const match = available.find((m) => m.tier === tier && m.capabilities.includes("chat"));
    if (match) {
      return match;
    }
  }

  // Last resort: any available model
  return available[0] ?? null;
}

export function selectEmbeddingModel(available: ModelInfo[]): ModelInfo | null {
  // Prefer dedicated embedding models first
  const dedicated = available.find((m) => m.capabilities.includes("embedding"));
  if (dedicated) return dedicated;

  // Fall back to any chat model (most can also embed)
  return available[0] ?? null;
}
