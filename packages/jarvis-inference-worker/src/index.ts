export * from "./types.js";
export * from "./adapter.js";
export * from "./default-adapter.js";
export * from "./mock.js";
export * from "./execute.js";

import type { InferenceAdapter } from "./adapter.js";
import { DefaultInferenceAdapter } from "./default-adapter.js";
import { MockInferenceAdapter } from "./mock.js";

export function createInferenceAdapter(mode: "mock" | "real"): InferenceAdapter {
  return mode === "real"
    ? new DefaultInferenceAdapter()
    : new MockInferenceAdapter();
}
