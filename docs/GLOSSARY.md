# Glossary

Canonical vocabulary for the Jarvis system. Every document and code comment should use these terms consistently.

## Core Concepts

**Agent** -- A named autonomous workflow (e.g., `proposal-engine`) with a system prompt, capabilities, approval gates, and schedule. Agents define *what* to do; plugins and workers handle *how*. Each agent belongs to a product tier and has a maturity level that governs its approval policy.

**Plugin** -- An OpenClaw extension that registers tools and commands for agents (e.g., `@jarvis/email-plugin`). Plugins expose the agent-facing interface; they translate tool calls into job submissions. There are 19 Jarvis plugins registered with the gateway.

**Worker** -- An async job processor that executes a specific job family (e.g., `@jarvis/email-worker`). Workers claim jobs from the queue via HTTP, execute them, send heartbeats to renew their lease, and return results via callback. Workers run either in-process or as child processes.

**Tool** -- A function agents call via the plugin SDK; returns structured results (e.g., `email_search`). Tools are the agent-visible surface of a plugin. Each tool call produces a deterministic job spec submitted to the job queue.

**Job** -- A queued unit of work with a type, input payload, and expected output (e.g., `email.send`). Jobs are the atomic unit of execution. There are 144 defined job types across 27 schema families.

**Run** -- A single execution of an agent, tracked from planning through completion. Runs progress through a state machine (queued, planning, executing, awaiting_approval, completed, failed, cancelled) and emit events to the `run_events` table for audit.

**Command** -- An operator instruction to start an agent run, stored in the `agent_commands` table. Commands flow from channels (Telegram, dashboard, CLI) into the runtime kernel, which creates a run.

**Approval** -- A human-gated decision point for high-stakes actions. Approvals are created in `pending` state and transition to `approved`, `rejected`, `expired`, or `cancelled`. Of 144 job types, 17 always require approval and 33 are conditionally gated.

## Outputs and Delivery

**Artifact** -- An output produced by a run (report, draft, analysis, gap matrix) delivered to the operator via one or more channels. Artifacts are the tangible result of agent work.

**Channel** -- A communication surface through which operators interact with Jarvis: Telegram, dashboard, email, or webhook. Each channel has its own delivery characteristics and authentication model.

**Thread** -- A conversation context within a channel (e.g., a Telegram chat, a dashboard session). Threads allow multi-turn interaction and contextual follow-ups within a single channel.

## Wire Format

**Envelope** -- A job's wire format conforming to the `jarvis.v1` contract. Contains the job type, input payload, metadata (attempt number, correlation ID, timestamps), and schema version. Validated against `job-envelope.schema.json`.

## Classification

**Product Tier** -- Agent classification reflecting its operational domain: `core` (production consulting workflows), `extended` (supporting business functions), `personal` (operator personal tasks), or `experimental` (under development).

**Maturity** -- Agent execution policy governing approval strictness: `high_stakes_manual_gate` (every mutation needs approval), `trusted_with_review` (runs autonomously, outputs reviewed), `operational` (standard approval gates), or `experimental` (limited trust, monitoring required).

## Security

**Appliance Mode** -- Strict security posture activated by setting `appliance_mode: true` in config or `JARVIS_MODE=production`. Requires API tokens, enforces webhook secrets, binds to localhost only, and blocks startup if security prerequisites are missing.
