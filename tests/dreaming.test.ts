/**
 * Unit tests for DreamingOrchestrator (Epic 8).
 */

import { describe, it, expect } from "vitest";
import {
  DreamingOrchestrator,
  DEFAULT_DREAMING_CONFIG,
  PILOT_DREAMING_CONFIG,
  type DreamingConfig,
} from "@jarvis/runtime";

// Mock data generators
function mockLessons(agentId: string) {
  return [
    { content: "Client prefers PDF deliverables", tags: ["delivery", "format"], created_at: "2026-04-01" },
    { content: "Always include executive summary", tags: ["delivery", "format"], created_at: "2026-04-02" },
    { content: "ISO 26262 Part 6 requires tool qualification", tags: ["iso26262", "tools"], created_at: "2026-04-03" },
    { content: "Use ASIL decomposition for complex items", tags: ["iso26262", "safety"], created_at: "2026-04-04" },
    { content: "Unique observation", tags: ["unique"], created_at: "2026-04-05" },
  ];
}

function mockEntities(agentId: string) {
  return [
    { entity_id: "e1", name: "Acme Corp", type: "company" },
    { entity_id: "e2", name: "acme corp", type: "company" }, // duplicate
    { entity_id: "e3", name: "Bob Smith", type: "contact" },
    { entity_id: "e4", name: "Bob Smith", type: "contact" }, // duplicate
    { entity_id: "e5", name: "ISO 26262", type: "standard" },
  ];
}

function mockKnowledge(agentId: string) {
  return [
    { doc_id: "d1", title: "Proposal Template", content: "...", tags: ["proposal", "template"] },
    { doc_id: "d2", title: "Safety Analysis Guide", content: "...", tags: ["safety", "iso26262"] },
    { doc_id: "d3", title: "Compliance Checklist", content: "...", tags: ["iso26262", "compliance"] },
    { doc_id: "d4", title: "Client Brief", content: "...", tags: ["proposal", "client"] },
  ];
}

describe("DreamingOrchestrator", () => {
  it("is disabled by default", () => {
    const orch = new DreamingOrchestrator();
    expect(orch.isEnabled()).toBe(false);
  });

  it("is enabled with pilot config", () => {
    const orch = new DreamingOrchestrator(PILOT_DREAMING_CONFIG);
    expect(orch.isEnabled()).toBe(true);
    expect(orch.getConfig().enabled_agents).toEqual([
      "proposal-engine", "regulatory-watch", "knowledge-curator",
    ]);
  });

  it("returns empty run when disabled", async () => {
    const orch = new DreamingOrchestrator();
    const run = await orch.execute({
      queryLessons: mockLessons,
      queryEntities: mockEntities,
      queryKnowledge: mockKnowledge,
    });
    expect(run.status).toBe("completed");
    expect(run.agents_processed).toHaveLength(0);
    expect(run.synthesis_results).toHaveLength(0);
  });

  it("runs all 3 synthesis modes for each enabled agent", async () => {
    const config: DreamingConfig = {
      enabled_agents: ["test-agent"],
      schedule_cron: "0 3 * * *",
      max_duration_ms: 60_000,
      synthesis_modes: ["lesson_consolidation", "entity_dedup", "cross_reference"],
      require_approval: false,
    };
    const orch = new DreamingOrchestrator(config);

    const run = await orch.execute({
      queryLessons: mockLessons,
      queryEntities: mockEntities,
      queryKnowledge: mockKnowledge,
    });

    expect(run.status).toBe("completed");
    expect(run.agents_processed).toEqual(["test-agent"]);
    expect(run.synthesis_results).toHaveLength(3);

    const modes = run.synthesis_results.map((r) => r.mode);
    expect(modes).toContain("lesson_consolidation");
    expect(modes).toContain("entity_dedup");
    expect(modes).toContain("cross_reference");
  });

  it("lesson_consolidation finds duplicate tag groups", async () => {
    const config: DreamingConfig = {
      enabled_agents: ["test-agent"],
      schedule_cron: "0 3 * * *",
      max_duration_ms: 60_000,
      synthesis_modes: ["lesson_consolidation"],
      require_approval: false,
    };
    const orch = new DreamingOrchestrator(config);

    const run = await orch.execute({
      queryLessons: mockLessons,
      queryEntities: mockEntities,
      queryKnowledge: mockKnowledge,
    });

    const result = run.synthesis_results[0];
    expect(result.mode).toBe("lesson_consolidation");
    expect(result.items_scanned).toBe(5);
    expect(result.items_consolidated).toBeGreaterThan(0); // "delivery,format" appears twice
  });

  it("entity_dedup finds case-insensitive duplicates", async () => {
    const config: DreamingConfig = {
      enabled_agents: ["test-agent"],
      schedule_cron: "0 3 * * *",
      max_duration_ms: 60_000,
      synthesis_modes: ["entity_dedup"],
      require_approval: false,
    };
    const orch = new DreamingOrchestrator(config);

    const run = await orch.execute({
      queryLessons: mockLessons,
      queryEntities: mockEntities,
      queryKnowledge: mockKnowledge,
    });

    const result = run.synthesis_results[0];
    expect(result.mode).toBe("entity_dedup");
    expect(result.items_scanned).toBe(5);
    expect(result.items_consolidated).toBe(2); // "acme corp" and "bob smith"
  });

  it("cross_reference finds tag-based connections", async () => {
    const config: DreamingConfig = {
      enabled_agents: ["test-agent"],
      schedule_cron: "0 3 * * *",
      max_duration_ms: 60_000,
      synthesis_modes: ["cross_reference"],
      require_approval: false,
    };
    const orch = new DreamingOrchestrator(config);

    const run = await orch.execute({
      queryLessons: mockLessons,
      queryEntities: mockEntities,
      queryKnowledge: mockKnowledge,
    });

    const result = run.synthesis_results[0];
    expect(result.mode).toBe("cross_reference");
    expect(result.items_scanned).toBe(4);
    expect(result.items_promoted).toBeGreaterThan(0); // "iso26262" and "proposal" tags shared
  });

  it("has no current run when idle", () => {
    const orch = new DreamingOrchestrator(PILOT_DREAMING_CONFIG);
    expect(orch.getCurrentRun()).toBeNull();
  });

  it("pilot config has exactly 3 agents", () => {
    expect(PILOT_DREAMING_CONFIG.enabled_agents).toHaveLength(3);
    expect(PILOT_DREAMING_CONFIG.require_approval).toBe(true);
  });

  it("default config is disabled", () => {
    expect(DEFAULT_DREAMING_CONFIG.enabled_agents).toHaveLength(0);
  });
});
