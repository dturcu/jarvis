import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readDoc(relativePath: string) {
  const fileUrl = new URL(`../${relativePath}`, import.meta.url);
  return readFileSync(fileUrl, "utf8");
}

function extractCanonicalJson(markdown: string) {
  const match = markdown.match(/```json\s*([\s\S]*?)```/);
  expect(match?.[1]).toBeTruthy();
  return JSON.parse(match![1]) as {
    agents: {
      defaults: {
        model: {
          primary: string;
        };
      };
      list: Array<{
        id: string;
        default: boolean;
        tools: {
          profile: string;
        };
      }>;
    };
    skills: {
      allowBundled: unknown[];
    };
  };
}

describe("Jarvis local-model runtime strategy", () => {
  it("codifies the canonical lean smoke agent and hard-gated tool path", () => {
    const strategy = readDoc("docs/specs/local-model-runtime-strategy.md");
    const config = extractCanonicalJson(strategy);

    expect(strategy).toContain("Canonical profile: `jarvis-smoke`");
    expect(strategy).toContain("Canonical lean agent: `smoke`");
    expect(strategy).toContain("Canonical LM Studio identifier: `jarvis-smoke-32k`");
    expect(strategy).toContain("Canonical LM Studio model key: `qwen/qwen3.5-35b-a3b`");
    expect(strategy).toContain("The hard gate is the OpenClaw tool path.");
    expect(strategy).toContain("The conversational agent check is best-effort only.");
    expect(strategy).toContain("Use `smoke`, not `main`");

    expect(config.agents.defaults.model.primary).toBe("lmstudio/jarvis-smoke-32k");
    expect(config.agents.list).toHaveLength(1);
    expect(config.agents.list[0]).toMatchObject({
      id: "smoke",
      default: true,
      tools: {
        profile: "minimal",
      },
    });
    expect(config.skills.allowBundled).toEqual([]);
  });

  it("keeps the runbook aligned with the strategy", () => {
    const runbook = readDoc("docs/runbooks/openclaw-lmstudio-smoke.md");

    expect(runbook).toContain("lean conversational agent: `smoke`");
    expect(runbook).toContain("Tool-path success is the hard gate.");
    expect(runbook).toContain("Do not use `main` for this lane.");
    expect(runbook).toContain("Treat the direct conversational agent check as best-effort");
    expect(runbook).toContain("JARVIS_SMOKE_AGENT_CHECK=0");
  });
});
