# Agent Roster Reset — 2026-04-08

## What happened

The original 15-agent production roster was retired and archived to
`packages/jarvis-agents/src/legacy/`. The active roster (`ALL_AGENTS`)
is now empty, ready for the new production agent architecture.

## Why

The original roster grew organically and included personal, experimental,
and fragmented agents that did not meet production quality bar. A clean
reset allows building a smaller, more coherent set of agents that each
own a real business loop and produce durable artifacts.

## What was preserved

- **Agent definitions**: moved to `src/legacy/definitions/` (15 files)
- **System prompts**: moved to `src/legacy/prompts/` (14 files)
- **Skill files**: moved to `.claude/skills/legacy/` (8 files)
- **Legacy barrel export**: `@jarvis/agents/legacy` re-exports all 15
  agents and a `LEGACY_AGENTS` array for reference and testing
- **Runtime databases**: untouched (`runtime.db`, `crm.db`, `knowledge.db`)
- **Job schemas and contracts**: untouched
- **Workflow definitions**: untouched (will be updated when new agents wire in)
- **Git history**: all files moved via `git mv` — full history preserved

## What changed

| File | Change |
|------|--------|
| `packages/jarvis-agents/src/index.ts` | Exports only `ALL_AGENTS` (empty), `getAgent`, `listAgents` |
| `packages/jarvis-agents/src/registry.ts` | `ALL_AGENTS = []` |
| `packages/jarvis-agents/package.json` | Added `./legacy` subpath export |
| `packages/jarvis-runtime/src/starter-packs.ts` | Reduced to single empty dev pack |
| `packages/jarvis-runtime/src/agent-queue.ts` | Cleared browser agent set |
| `vitest.config.ts` | Added `@jarvis/agents/legacy` alias |
| `tests/agent-definitions.test.ts` | Rewritten for empty active + legacy validation |
| `tests/self-reflection-agent.test.ts` | Imports from legacy |
| `tests/core-workflow-focus.test.ts` | Updated assertions for empty roster |
| `tests/smoke/integration.test.ts` | Relaxed high-stakes count assertion |

## How to restore a legacy agent

```typescript
// In registry.ts, selectively re-activate:
import { bdPipelineAgent } from "./legacy/definitions/bd-pipeline.js";

export const ALL_AGENTS: AgentDefinition[] = [
  bdPipelineAgent,
];
```

Or import directly in consumer code:

```typescript
import { bdPipelineAgent } from "@jarvis/agents/legacy";
```
