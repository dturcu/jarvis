import { describe, expect, it } from "vitest";
import {
  orchestratorAgent,
  selfReflectionAgent,
  regulatoryWatchAgent,
  knowledgeCuratorAgent,
  proposalEngineAgent,
  evidenceAuditorAgent,
  contractReviewerAgent,
  staffingMonitorAgent,
  getAgent,
  listAgents,
  ALL_AGENTS,
} from "@jarvis/agents";

// ---------------------------------------------------------------------------
// Active roster — 8 agents
// ---------------------------------------------------------------------------

describe("active roster", () => {
  it("ALL_AGENTS has exactly 8 agents", () => {
    expect(ALL_AGENTS).toHaveLength(8);
  });

  it("all agent_ids are unique", () => {
    const ids = ALL_AGENTS.map(a => a.agent_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("all agents are version 1.0.0", () => {
    for (const agent of ALL_AGENTS) {
      expect(agent.version).toBe("1.0.0");
    }
  });

  it("listAgents returns all 8", () => {
    expect(listAgents()).toHaveLength(8);
  });
});

// ---------------------------------------------------------------------------
// Registry lookups
// ---------------------------------------------------------------------------

describe("registry", () => {
  it("getAgent resolves all 8 by ID", () => {
    const ids = [
      "orchestrator", "self-reflection", "regulatory-watch", "knowledge-curator",
      "proposal-engine", "evidence-auditor", "contract-reviewer", "staffing-monitor",
    ];
    for (const id of ids) {
      expect(getAgent(id), `${id} not found`).toBeDefined();
    }
  });

  it("getAgent returns undefined for retired agents", () => {
    expect(getAgent("bd-pipeline")).toBeUndefined();
    expect(getAgent("content-engine")).toBeUndefined();
    expect(getAgent("portfolio-monitor")).toBeUndefined();
    expect(getAgent("garden-calendar")).toBeUndefined();
  });

  it("getAgent returns undefined for unknown agents", () => {
    expect(getAgent("unknown")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Structural invariants
// ---------------------------------------------------------------------------

describe("structural invariants", () => {
  it("every agent has a non-empty system_prompt", () => {
    for (const agent of ALL_AGENTS) {
      expect(agent.system_prompt.trim().length, `${agent.agent_id}`).toBeGreaterThan(0);
    }
  });

  it("every agent has at least one trigger", () => {
    for (const agent of ALL_AGENTS) {
      expect(agent.triggers.length, `${agent.agent_id}`).toBeGreaterThanOrEqual(1);
    }
  });

  it("every agent has non-empty capabilities", () => {
    for (const agent of ALL_AGENTS) {
      expect(agent.capabilities.length, `${agent.agent_id}`).toBeGreaterThan(0);
    }
  });

  it("every agent has a knowledge_collections array", () => {
    for (const agent of ALL_AGENTS) {
      expect(Array.isArray(agent.knowledge_collections)).toBe(true);
    }
  });

  it("every agent has non-empty label and description", () => {
    for (const agent of ALL_AGENTS) {
      expect(agent.label.trim().length, `${agent.agent_id} label`).toBeGreaterThan(0);
      expect(agent.description.trim().length, `${agent.agent_id} desc`).toBeGreaterThan(0);
    }
  });

  it("every agent has a valid task_profile objective", () => {
    const valid = ["plan", "execute", "critique", "summarize", "extract", "classify", "answer", "code", "rag_synthesis"];
    for (const agent of ALL_AGENTS) {
      expect(valid, `${agent.agent_id}`).toContain(agent.task_profile.objective);
    }
  });

  it("every agent has a positive max_steps_per_run", () => {
    for (const agent of ALL_AGENTS) {
      expect(agent.max_steps_per_run, `${agent.agent_id}`).toBeGreaterThan(0);
    }
  });

  it("every agent has at least one output_channel", () => {
    for (const agent of ALL_AGENTS) {
      expect(agent.output_channels.length, `${agent.agent_id}`).toBeGreaterThanOrEqual(1);
    }
  });

  it("every agent has an explicit planner_mode", () => {
    const valid = ["single", "critic", "multi"];
    for (const agent of ALL_AGENTS) {
      expect(agent.planner_mode, `${agent.agent_id}`).toBeDefined();
      expect(valid).toContain(agent.planner_mode);
    }
  });

  it("every agent has pack=core", () => {
    for (const agent of ALL_AGENTS) {
      expect(agent.pack, `${agent.agent_id}`).toBe("core");
    }
  });
});

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

describe("orchestratorAgent", () => {
  it("agent_id === orchestrator", () => {
    expect(orchestratorAgent.agent_id).toBe("orchestrator");
  });

  it("is high_stakes_manual_gate maturity", () => {
    expect(orchestratorAgent.maturity).toBe("high_stakes_manual_gate");
  });

  it("uses multi planner mode", () => {
    expect(orchestratorAgent.planner_mode).toBe("multi");
  });

  it("has the highest max_steps_per_run", () => {
    for (const agent of ALL_AGENTS) {
      expect(orchestratorAgent.max_steps_per_run).toBeGreaterThanOrEqual(agent.max_steps_per_run);
    }
  });

  it("is experimental (top-level, high-stakes)", () => {
    expect(orchestratorAgent.experimental).toBe(true);
  });

  it("requires review", () => {
    expect(orchestratorAgent.review_required).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Self-Reflection
// ---------------------------------------------------------------------------

describe("selfReflectionAgent", () => {
  it("agent_id === self-reflection", () => {
    expect(selfReflectionAgent.agent_id).toBe("self-reflection");
  });

  it("has weekly Sunday schedule", () => {
    const sched = selfReflectionAgent.triggers.find(t => t.kind === "schedule");
    expect(sched).toBeDefined();
    expect(sched!.cron).toBe("0 6 * * 0");
  });

  it("uses critic planner mode", () => {
    expect(selfReflectionAgent.planner_mode).toBe("critic");
  });

  it("has no approval gates (read-only analysis)", () => {
    expect(selfReflectionAgent.approval_gates).toHaveLength(0);
  });

  it("system prompt forbids auto-apply", () => {
    expect(selfReflectionAgent.system_prompt).toContain("Auto-apply changes to production prompts");
  });

  it("requires review", () => {
    expect(selfReflectionAgent.review_required).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Regulatory Watch
// ---------------------------------------------------------------------------

describe("regulatoryWatchAgent", () => {
  it("agent_id === regulatory-watch", () => {
    expect(regulatoryWatchAgent.agent_id).toBe("regulatory-watch");
  });

  it("has bi-weekly schedule (Mon, Thu)", () => {
    const sched = regulatoryWatchAgent.triggers.find(t => t.kind === "schedule");
    expect(sched).toBeDefined();
    expect(sched!.cron).toBe("0 7 * * 1,4");
  });

  it("feeds regulatory knowledge collection", () => {
    expect(regulatoryWatchAgent.knowledge_collections).toContain("regulatory");
  });

  it("has no approval gates (intelligence gathering)", () => {
    expect(regulatoryWatchAgent.approval_gates).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Knowledge Curator
// ---------------------------------------------------------------------------

describe("knowledgeCuratorAgent", () => {
  it("agent_id === knowledge-curator", () => {
    expect(knowledgeCuratorAgent.agent_id).toBe("knowledge-curator");
  });

  it("owns the most knowledge collections", () => {
    for (const agent of ALL_AGENTS) {
      expect(knowledgeCuratorAgent.knowledge_collections.length)
        .toBeGreaterThanOrEqual(agent.knowledge_collections.length);
    }
  });

  it("has document.received event trigger", () => {
    const evt = knowledgeCuratorAgent.triggers.find(t => t.kind === "event");
    expect(evt).toBeDefined();
    expect(evt!.event_type).toBe("document.received");
  });

  it("has knowledge.delete approval gate at critical", () => {
    const gate = knowledgeCuratorAgent.approval_gates.find(g => g.action === "knowledge.delete");
    expect(gate).toBeDefined();
    expect(gate!.severity).toBe("critical");
  });
});

// ---------------------------------------------------------------------------
// Business agents: Proposal, Evidence, Contract, Staffing
// ---------------------------------------------------------------------------

describe("proposalEngineAgent", () => {
  it("agent_id === proposal-engine", () => {
    expect(proposalEngineAgent.agent_id).toBe("proposal-engine");
  });

  it("has email.send critical approval gate", () => {
    const gate = proposalEngineAgent.approval_gates.find(g => g.action === "email.send");
    expect(gate?.severity).toBe("critical");
  });

  it("is high_stakes_manual_gate maturity", () => {
    expect(proposalEngineAgent.maturity).toBe("high_stakes_manual_gate");
  });

  it("knowledge includes regulatory", () => {
    expect(proposalEngineAgent.knowledge_collections).toContain("regulatory");
  });
});

describe("evidenceAuditorAgent", () => {
  it("agent_id === evidence-auditor", () => {
    expect(evidenceAuditorAgent.agent_id).toBe("evidence-auditor");
  });

  it("has Monday schedule", () => {
    const sched = evidenceAuditorAgent.triggers.find(t => t.kind === "schedule");
    expect(sched!.cron).toBe("0 9 * * 1");
  });

  it("system prompt includes ISO 26262", () => {
    expect(evidenceAuditorAgent.system_prompt).toContain("ISO 26262");
  });

  it("knowledge includes regulatory", () => {
    expect(evidenceAuditorAgent.knowledge_collections).toContain("regulatory");
  });
});

describe("contractReviewerAgent", () => {
  it("agent_id === contract-reviewer", () => {
    expect(contractReviewerAgent.agent_id).toBe("contract-reviewer");
  });

  it("uses multi planner (high-stakes)", () => {
    expect(contractReviewerAgent.planner_mode).toBe("multi");
  });

  it("system prompt includes jurisdiction baseline", () => {
    expect(contractReviewerAgent.system_prompt).toContain("Jurisdiction:");
  });

  it("knowledge includes regulatory", () => {
    expect(contractReviewerAgent.knowledge_collections).toContain("regulatory");
  });
});

describe("staffingMonitorAgent", () => {
  it("agent_id === staffing-monitor", () => {
    expect(staffingMonitorAgent.agent_id).toBe("staffing-monitor");
  });

  it("has email.send critical gate (internal only)", () => {
    const gate = staffingMonitorAgent.approval_gates.find(g => g.action === "email.send");
    expect(gate?.severity).toBe("critical");
  });

  it("system prompt includes utilization", () => {
    expect(staffingMonitorAgent.system_prompt).toContain("utilization");
  });
});

// ---------------------------------------------------------------------------
// Approval policy compliance
// ---------------------------------------------------------------------------

describe("approval policy", () => {
  it("email-sending agents have critical severity on email.send", () => {
    const emailSenders = ALL_AGENTS.filter(a =>
      a.approval_gates.some(g => g.action === "email.send"),
    );
    expect(emailSenders.length).toBeGreaterThanOrEqual(2);
    for (const agent of emailSenders) {
      const gate = agent.approval_gates.find(g => g.action === "email.send");
      expect(gate!.severity, `${agent.agent_id}`).toBe("critical");
    }
  });

  it("high_stakes_manual_gate agents use multi planner", () => {
    const highStakes = ALL_AGENTS.filter(a => a.maturity === "high_stakes_manual_gate");
    expect(highStakes.length).toBeGreaterThan(0);
    for (const agent of highStakes) {
      expect(agent.planner_mode, `${agent.agent_id}`).toBe("multi");
    }
  });
});
