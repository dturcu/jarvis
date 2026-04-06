export * from "./types.js";
export * from "./adapter.js";
export * from "./default-adapter.js";
export * from "./mock.js";
export * from "./execute.js";

import type { DatabaseSync } from "node:sqlite";
import type { InferenceAdapter } from "./adapter.js";
import { DefaultInferenceAdapter } from "./default-adapter.js";
import { MockInferenceAdapter } from "./mock.js";

export function createInferenceAdapter(mode: "mock" | "real", runtimeDb?: DatabaseSync, lmStudioUrl?: string): InferenceAdapter {
  return mode === "real"
    ? new DefaultInferenceAdapter(runtimeDb, lmStudioUrl)
    : new MockInferenceAdapter();
}
