import { describe, expect, it } from "vitest";
import { ALL_AGENTS } from "@jarvis/agents";
import { V1_WORKFLOWS, STARTER_PACKS } from "@jarvis/runtime";

/*
 * Y1-Q3 core-workflow-focus golden replay
 *
 * Validates agent pack classification, workflow alignment, starter pack
 * consistency, maturity enforcement rules, and agent metadata completeness.
 * These are structural invariants — no runtime, no daemon, pure data checks.
 */

const agentMap = new Map(ALL_AGENTS.map(a => [a.agent_id, a]));

const EXPECTED_CORE_IDS = [
  "bd-pipeline",
  "proposal-engine",
  "evidence-auditor",
  "contract-reviewer",
  "staffing-monitor",
];

const EXPECTED_PERSONAL_IDS = [
  "portfolio-monitor",
  "garden-calendar",
];

const EXPECTED_EXPERIMENTAL_IDS = [
  "content-engine",
  "social-engagement",
  "security-monitor",
  "invoice-generator",
  "email-campaign",
  "meeting-transcriber",
  "drive-watcher",
  "self-reflection",
];

// ---------------------------------------------------------------------------
// Agent pack classification
// ---------------------------------------------------------------------------

describe("agent pack classification", () => {
  it("all 15 agents have a pack field defined", () => {
    expect(ALL_AGENTS).toHaveLength(15);
    for (const agent of ALL_AGENTS) {
      expect(agent.pack, `${agent.agent_id} missing pack`).toBeDefined();
    }
  });

  it('exactly 5 agents have pack "core"', () => {
    const core = ALL_AGENTS.filter(a => a.pack === "core");
    expect(core.map(a => a.agent_id).sort()).toEqual([...EXPECTED_CORE_IDS].sort());
    expect(core).toHaveLength(5);
  });

  it('exactly 2 agents have pack "personal"', () => {
    const personal = ALL_AGENTS.filter(a => a.pack === "personal");
    expect(personal.map(a => a.agent_id).sort()).toEqual([...EXPECTED_PERSONAL_IDS].sort());
    expect(personal).toHaveLength(2);
  });

  it('remaining 8 agents have pack "experimental"', () => {
    const experimental = ALL_AGENTS.filter(a => a.pack === "experimental");
    expect(experimental.map(a => a.agent_id).sort()).toEqual([...EXPECTED_EXPERIMENTAL_IDS].sort());
    expect(experimental).toHaveLength(8);
  });

  it("core agents have appropriate maturity levels (not experimental)", () => {
    for (const id of EXPECTED_CORE_IDS) {
      const agent = agentMap.get(id)!;
      expect(
        agent.maturity,
        `${id} maturity should not be "experimental"`,
      ).not.toBe("experimental");
    }
  });
});

// ---------------------------------------------------------------------------
// Workflow pack classification
// ---------------------------------------------------------------------------

describe("workflow pack classification", () => {
  it('all V1_WORKFLOWS have pack "core"', () => {
    for (const wf of V1_WORKFLOWS) {
      expect(wf.pack, `${wf.workflow_id} should have pack "core"`).toBe("core");
    }
  });

  it("each workflow references at least one core agent", () => {
    for (const wf of V1_WORKFLOWS) {
      const hasCore = wf.agent_ids.some(id => {
        const agent = agentMap.get(id);
        return agent?.pack === "core";
      });
      expect(hasCore, `${wf.workflow_id} should reference at least one core agent`).toBe(true);
    }
  });

  it("all workflow agent_ids exist in ALL_AGENTS", () => {
    for (const wf of V1_WORKFLOWS) {
      for (const id of wf.agent_ids) {
        expect(agentMap.has(id), `${wf.workflow_id} references unknown agent "${id}"`).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Starter pack consistency
// ---------------------------------------------------------------------------

describe("starter pack consistency", () => {
  const automotivePack = STARTER_PACKS.find(p => p.pack_id === "automotive-consulting")!;
  const devPack = STARTER_PACKS.find(p => p.pack_id === "development")!;

  it('"automotive-consulting" pack enables exactly the 5 core agents', () => {
    expect(automotivePack).toBeDefined();
    expect(automotivePack.enabled_agents.sort()).toEqual([...EXPECTED_CORE_IDS].sort());
    expect(automotivePack.enabled_agents).toHaveLength(5);
  });

  it('"development" pack enables all 15 agents', () => {
    expect(devPack).toBeDefined();
    expect(devPack.enabled_agents).toHaveLength(15);
    for (const agent of ALL_AGENTS) {
      expect(
        devPack.enabled_agents,
        `development pack missing ${agent.agent_id}`,
      ).toContain(agent.agent_id);
    }
  });

  it("all starter pack enabled_agents exist in ALL_AGENTS", () => {
    for (const pack of STARTER_PACKS) {
      for (const id of pack.enabled_agents) {
        expect(agentMap.has(id), `${pack.pack_id} references unknown agent "${id}"`).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Maturity enforcement rules
// ---------------------------------------------------------------------------

describe("maturity enforcement rules", () => {
  it('core agents: none have maturity "experimental"', () => {
    const coreAgents = ALL_AGENTS.filter(a => a.pack === "core");
    for (const agent of coreAgents) {
      expect(
        agent.maturity,
        `core agent ${agent.agent_id} should not have experimental maturity`,
      ).not.toBe("experimental");
    }
  });

  it("agents with experimental pack or experimental=true should not auto-schedule", () => {
    const experimentalAgents = ALL_AGENTS.filter(
      a => a.pack === "experimental" || a.experimental === true,
    );
    expect(experimentalAgents.length).toBeGreaterThan(0);

    for (const agent of experimentalAgents) {
      // An experimental agent may have schedule triggers in its definition,
      // but the scheduler should gate on experimental=true / pack.
      // Here we verify the data that drives the scheduler: every agent
      // that is experimental has the experimental flag set to true, so the
      // scheduler can skip them without needing to inspect pack separately.
      expect(
        agent.experimental,
        `${agent.agent_id} (pack=${agent.pack}) should have experimental=true so the scheduler can skip it`,
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Agent metadata completeness
// ---------------------------------------------------------------------------

describe("agent metadata completeness", () => {
  it("all agents have: agent_id, label, description, triggers, capabilities, system_prompt", () => {
    for (const agent of ALL_AGENTS) {
      expect(agent.agent_id, `agent missing agent_id`).toBeDefined();
      expect(agent.label, `${agent.agent_id} missing label`).toBeDefined();
      expect(agent.description, `${agent.agent_id} missing description`).toBeDefined();
      expect(agent.triggers, `${agent.agent_id} missing triggers`).toBeDefined();
      expect(agent.capabilities, `${agent.agent_id} missing capabilities`).toBeDefined();
      expect(agent.system_prompt, `${agent.agent_id} missing system_prompt`).toBeDefined();
    }
  });

  it("all agents have non-empty system_prompt", () => {
    for (const agent of ALL_AGENTS) {
      expect(
        agent.system_prompt.trim().length,
        `${agent.agent_id} system_prompt is empty`,
      ).toBeGreaterThan(0);
    }
  });

  it("all agents have at least one trigger", () => {
    for (const agent of ALL_AGENTS) {
      expect(
        agent.triggers.length,
        `${agent.agent_id} has no triggers`,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it("core agents have at least one knowledge_collection", () => {
    const coreAgents = ALL_AGENTS.filter(a => a.pack === "core");
    for (const agent of coreAgents) {
      expect(
        agent.knowledge_collections.length,
        `core agent ${agent.agent_id} should have at least one knowledge_collection`,
      ).toBeGreaterThanOrEqual(1);
    }
  });
});
