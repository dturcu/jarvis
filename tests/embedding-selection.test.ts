import { describe, expect, it } from "vitest";
import { selectEmbeddingModel, type ModelInfo } from "@jarvis/inference";

describe("embedding model selection", () => {
  it("prefers dedicated embedding models", () => {
    const models: ModelInfo[] = [
      { id: "gemma3-4b:latest", runtime: "ollama", size_class: "medium", capabilities: ["chat", "vision"] },
      { id: "text-embedding-nomic-embed-text-v1.5", runtime: "lmstudio", size_class: "small", capabilities: ["embedding"] },
    ];

    expect(selectEmbeddingModel(models)?.id).toBe("text-embedding-nomic-embed-text-v1.5");
  });

  it("does not silently fall back to chat-only models", () => {
    const models: ModelInfo[] = [
      { id: "gemma3-4b:latest", runtime: "ollama", size_class: "medium", capabilities: ["chat", "vision"] },
      { id: "qwen3.5-4b:latest", runtime: "ollama", size_class: "small", capabilities: ["chat"] },
    ];

    expect(selectEmbeddingModel(models)).toBeNull();
  });
});
