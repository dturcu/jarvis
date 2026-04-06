import { describe, expect, it } from "vitest";
import {
  bdPipelineAgent,
  proposalEngineAgent,
  evidenceAuditorAgent,
  contractReviewerAgent,
  staffingMonitorAgent,
  contentEngineAgent,
  portfolioMonitorAgent,
  gardenCalendarAgent,
  getAgent,
  listAgents,
  ALL_AGENTS,
} from "@jarvis/agents";

// K1: BD Pipeline

describe("bdPipelineAgent", () => {
  it("agent_id === bd-pipeline", () => {
    expect(bdPipelineAgent.agent_id).toBe("bd-pipeline");
  });

  it("triggers has schedule and manual", () => {
    const kinds = bdPipelineAgent.triggers.map(t => t.kind);
    expect(kinds).toContain("schedule");
    expect(kinds).toContain("manual");
  });

  it("schedule trigger uses weekday morning cron", () => {
    const st = bdPipelineAgent.triggers.find(t => t.kind === "schedule");
    expect(st).toBeDefined();
    if (st?.kind === "schedule") expect(st.cron).toBe("0 8 * * 1-5");
  });

  it("approval_gates has email.send as critical", () => {
    const gate = bdPipelineAgent.approval_gates.find(g => g.action === "email.send");
    expect(gate).toBeDefined();
    expect(gate?.severity).toBe("critical");
  });

  it("approval_gates has crm.move_stage as warning", () => {
    const gate = bdPipelineAgent.approval_gates.find(g => g.action === "crm.move_stage");
    expect(gate).toBeDefined();
    expect(gate?.severity).toBe("warning");
  });

  it("task_profile objective === plan", () => {
    expect(bdPipelineAgent.task_profile.objective).toBe("plan");
  });

  it("capabilities includes email web crm", () => {
    expect(bdPipelineAgent.capabilities).toContain("email");
    expect(bdPipelineAgent.capabilities).toContain("web");
    expect(bdPipelineAgent.capabilities).toContain("crm");
  });

  it("max_steps_per_run === 10", () => {
    expect(bdPipelineAgent.max_steps_per_run).toBe(10);
  });

  it("system_prompt includes AUTOSAR", () => {
    expect(bdPipelineAgent.system_prompt).toContain("AUTOSAR");
  });

  it("system_prompt includes ISO 26262", () => {
    expect(bdPipelineAgent.system_prompt).toContain("ISO 26262");
  });
});

// K2: Proposal Engine

describe("proposalEngineAgent", () => {
  it("agent_id === proposal-engine", () => {
    expect(proposalEngineAgent.agent_id).toBe("proposal-engine");
  });

  it("task_profile objective === plan with prioritize_accuracy", () => {
    expect(proposalEngineAgent.task_profile.objective).toBe("plan");
    expect(proposalEngineAgent.task_profile.preferences?.prioritize_accuracy).toBe(true);
  });

  it("approval_gates email.send severity === critical", () => {
    const gate = proposalEngineAgent.approval_gates.find(g => g.action === "email.send");
    expect(gate).toBeDefined();
    expect(gate?.severity).toBe("critical");
  });

  it("approval_gates has document.generate_report at warning", () => {
    const gate = proposalEngineAgent.approval_gates.find(g => g.action === "document.generate_report");
    expect(gate).toBeDefined();
    expect(gate?.severity).toBe("warning");
  });

  it("triggers has event trigger for email.received.rfq", () => {
    const et = proposalEngineAgent.triggers.find(t => t.kind === "event");
    expect(et).toBeDefined();
    if (et?.kind === "event") expect(et.event_type).toBe("email.received.rfq");
  });

  it("triggers has manual trigger", () => {
    expect(proposalEngineAgent.triggers.find(t => t.kind === "manual")).toBeDefined();
  });

  it("max_steps_per_run === 8", () => {
    expect(proposalEngineAgent.max_steps_per_run).toBe(8);
  });

  it("knowledge_collections includes contracts", () => {
    expect(proposalEngineAgent.knowledge_collections).toContain("contracts");
  });
});

// K3: Evidence Auditor

describe("evidenceAuditorAgent", () => {
  it("has the correct agent_id", () => {
    expect(evidenceAuditorAgent.agent_id).toBe("evidence-auditor");
  });

  it("has schedule trigger 0 9 * * 1", () => {
    const st = evidenceAuditorAgent.triggers.find(t => t.kind === "schedule");
    expect(st).toBeDefined();
    expect(st).toMatchObject({ kind: "schedule", cron: "0 9 * * 1" });
  });

  it("uses plan task profile", () => {
    expect(evidenceAuditorAgent.task_profile.objective).toBe("plan");
  });

  it("includes document and files in capabilities", () => {
    expect(evidenceAuditorAgent.capabilities).toContain("document");
    expect(evidenceAuditorAgent.capabilities).toContain("files");
  });

  it("system_prompt includes ISO 26262", () => {
    expect(evidenceAuditorAgent.system_prompt).toContain("ISO 26262");
  });
});

// K4: Contract Reviewer

describe("contractReviewerAgent", () => {
  it("has the correct agent_id", () => {
    expect(contractReviewerAgent.agent_id).toBe("contract-reviewer");
  });

  it("uses plan task profile with prioritize_accuracy", () => {
    expect(contractReviewerAgent.task_profile.objective).toBe("plan");
    expect(contractReviewerAgent.task_profile.preferences?.prioritize_accuracy).toBe(true);
  });

  it("has document.generate_report approval gate", () => {
    expect(contractReviewerAgent.approval_gates).toHaveLength(1);
    const gate = contractReviewerAgent.approval_gates.find(g => g.action === "document.generate_report");
    expect(gate).toBeDefined();
    expect(gate?.severity).toBe("warning");
  });

  it("system_prompt includes JURISDICTION", () => {
    expect(contractReviewerAgent.system_prompt).toContain("JURISDICTION");
  });
});

// K5: Staffing Monitor

describe("staffingMonitorAgent", () => {
  it("agent_id", () => {
    expect(staffingMonitorAgent.agent_id).toBe("staffing-monitor");
  });

  it("has monday schedule trigger", () => {
    const t = staffingMonitorAgent.triggers.find(
      t => t.kind === "schedule" && t.cron === "0 9 * * 1"
    );
    expect(t).toBeDefined();
    expect(t).toMatchObject({ kind: "schedule", cron: "0 9 * * 1" });
  });

  it("has email.send critical gate (per CLAUDE.md policy)", () => {
    const gate = staffingMonitorAgent.approval_gates.find(g => g.action === "email.send");
    expect(gate).toBeDefined();
    expect(gate?.severity).toBe("critical");
  });

  it("capabilities includes files and calendar", () => {
    expect(staffingMonitorAgent.capabilities).toContain("files");
    expect(staffingMonitorAgent.capabilities).toContain("calendar");
  });

  it("system_prompt includes utilization", () => {
    expect(staffingMonitorAgent.system_prompt).toContain("utilization");
  });
});

// K6: Content Engine

describe("contentEngineAgent", () => {
  it("agent_id", () => {
    expect(contentEngineAgent.agent_id).toBe("content-engine");
  });

  it("has 3 schedule triggers", () => {
    expect(contentEngineAgent.triggers).toHaveLength(3);
  });

  it("has publish_post critical approval gate (per CLAUDE.md policy)", () => {
    expect(contentEngineAgent.approval_gates).toHaveLength(1);
    const gate = contentEngineAgent.approval_gates.find(g => g.action === "publish_post");
    expect(gate).toBeDefined();
    expect(gate?.severity).toBe("critical");
  });

  it("system_prompt includes STYLE RULES", () => {
    expect(contentEngineAgent.system_prompt).toContain("STYLE RULES");
  });

  it("max_steps_per_run === 5", () => {
    expect(contentEngineAgent.max_steps_per_run).toBe(5);
  });
});

// K7: Portfolio Monitor

describe("portfolioMonitorAgent", () => {
  it("agent_id === portfolio-monitor", () => {
    expect(portfolioMonitorAgent.agent_id).toBe("portfolio-monitor");
  });

  it("has two schedule triggers", () => {
    const schedules = portfolioMonitorAgent.triggers.filter(t => t.kind === "schedule");
    expect(schedules.length).toBe(2);
  });

  it("trade_execute gate is critical", () => {
    const gate = portfolioMonitorAgent.approval_gates.find(g => g.action === "trade_execute");
    expect(gate).toBeDefined();
    expect(gate?.severity).toBe("critical");
  });

  it("uses classify task profile with prioritize_speed", () => {
    expect(portfolioMonitorAgent.task_profile.objective).toBe("classify");
    expect(portfolioMonitorAgent.task_profile.preferences?.prioritize_speed).toBe(true);
  });
});

// K8: Garden Calendar

describe("gardenCalendarAgent", () => {
  it("agent_id is non-empty", () => {
    expect(gardenCalendarAgent.agent_id.trim().length).toBeGreaterThan(0);
  });

  it("has at least one trigger", () => {
    expect(gardenCalendarAgent.triggers.length).toBeGreaterThanOrEqual(1);
  });

  it("has an approval_gates array (may be empty for read-only agents)", () => {
    expect(Array.isArray(gardenCalendarAgent.approval_gates)).toBe(true);
  });
});

// Registry

describe("registry", () => {
  it("getAgent bd-pipeline returns bdPipelineAgent", () => {
    expect(getAgent("bd-pipeline")).toBe(bdPipelineAgent);
  });

  it("getAgent proposal-engine returns proposalEngineAgent", () => {
    expect(getAgent("proposal-engine")).toBe(proposalEngineAgent);
  });

  it("getAgent evidence-auditor resolves", () => {
    expect(getAgent("evidence-auditor")).toBeDefined();
  });

  it("getAgent contract-reviewer resolves", () => {
    expect(getAgent("contract-reviewer")).toBeDefined();
  });

  it("getAgent unknown returns undefined", () => {
    expect(getAgent("unknown")).toBeUndefined();
  });

  it("listAgents returns at least 2 agents", () => {
    expect(listAgents().length).toBeGreaterThanOrEqual(2);
  });
});

// All agents structural invariants

describe("all agents structural invariants", () => {
  it("every agent has a non-empty system_prompt", () => {
    for (const agent of ALL_AGENTS) {
      expect(agent.system_prompt.trim().length).toBeGreaterThan(0);
    }
  });

  it("every agent has at least one trigger", () => {
    for (const agent of ALL_AGENTS) {
      expect(agent.triggers.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("every agent has at least one approval_gate except read-only and auto-mode agents", () => {
    const exempt = ["garden-calendar", "security-monitor", "meeting-transcriber", "drive-watcher"];
    const required = ALL_AGENTS.filter(a => !exempt.includes(a.agent_id));
    for (const agent of required) {
      expect(agent.approval_gates.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("every agent has a non-empty capabilities array", () => {
    for (const agent of ALL_AGENTS) {
      expect(agent.capabilities.length).toBeGreaterThan(0);
    }
  });

  it("every agent has a knowledge_collections array", () => {
    for (const agent of ALL_AGENTS) {
      expect(Array.isArray(agent.knowledge_collections)).toBe(true);
    }
  });

  it("every agent has a non-empty label", () => {
    for (const agent of ALL_AGENTS) {
      expect(agent.label.trim().length).toBeGreaterThan(0);
    }
  });

  it("every agent has a non-empty description", () => {
    for (const agent of ALL_AGENTS) {
      expect(agent.description.trim().length).toBeGreaterThan(0);
    }
  });

  it("every agent has a valid task_profile with an objective", () => {
    const validObjectives = ["plan", "execute", "critique", "summarize", "extract", "classify", "answer", "code", "rag_synthesis"];
    for (const agent of ALL_AGENTS) {
      expect(agent.task_profile).toBeDefined();
      expect(validObjectives).toContain(agent.task_profile.objective);
    }
  });

  it("every agent has a positive max_steps_per_run", () => {
    for (const agent of ALL_AGENTS) {
      expect(agent.max_steps_per_run).toBeGreaterThan(0);
    }
  });

  it("every agent has at least one output_channel", () => {
    for (const agent of ALL_AGENTS) {
      expect(agent.output_channels.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("all agent_ids are unique", () => {
    const ids = ALL_AGENTS.map(a => a.agent_id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("every agent has an explicit planner_mode", () => {
    const validModes = ["single", "critic", "multi"];
    for (const agent of ALL_AGENTS) {
      expect(agent.planner_mode, `${agent.agent_id} missing planner_mode`).toBeDefined();
      expect(validModes).toContain(agent.planner_mode);
    }
  });

  it("experimental agents are correctly marked", () => {
    const expectedExperimental = [
      "content-engine",
      "portfolio-monitor",
      "garden-calendar",
      "social-engagement",
      "security-monitor",
      "invoice-generator",
      "email-campaign",
      "meeting-transcriber",
      "drive-watcher",
    ];
    const expectedProduction = [
      "bd-pipeline",
      "proposal-engine",
      "evidence-auditor",
      "contract-reviewer",
      "staffing-monitor",
    ];

    for (const agentId of expectedExperimental) {
      const agent = ALL_AGENTS.find(a => a.agent_id === agentId);
      expect(agent, `${agentId} not found`).toBeDefined();
      expect(agent!.experimental, `${agentId} should be experimental`).toBe(true);
    }

    for (const agentId of expectedProduction) {
      const agent = ALL_AGENTS.find(a => a.agent_id === agentId);
      expect(agent, `${agentId} not found`).toBeDefined();
      expect(agent!.experimental, `${agentId} should NOT be experimental`).toBeFalsy();
    }
  });

  it("email-sending agents that are external-facing have critical severity", () => {
    const externalFacing = ["bd-pipeline", "proposal-engine"];
    for (const agent of ALL_AGENTS.filter(a => externalFacing.includes(a.agent_id))) {
      const emailGates = agent.approval_gates.filter(g => g.action === "email.send");
      for (const gate of emailGates) {
        expect(gate.severity).toBe("critical");
      }
    }
  });
});
