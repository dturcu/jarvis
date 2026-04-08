# Architecture Status

Honest comparison of the target design versus what has actually shipped. Updated each quarter.

Last updated: 2026-04-08

## Status Key

- **Shipped** -- target design is fully implemented
- **Partial** -- core capability shipped with documented exceptions
- **Gap** -- target design is not yet implemented

## Comparison

| Capability | Target Design | Shipped Implementation | Status |
|---|---|---|---|
| **Runtime kernel as sole authority** | All state mutations flow through the runtime kernel. No surface can bypass the kernel to mutate state. | Shipped. Chat and Telegram are read-only ingress. `trigger_agent` removed from chat surfaces. Copilot surfaces (`/api/chat`, `/api/godmode`) have their own LLM loops but cannot mutate state. Documented in [ADR-CHAT-SURFACES.md](ADR-CHAT-SURFACES.md). | Partial |
| **Durable state in runtime.db** | All control-plane state (runs, approvals, jobs, heartbeats, model registry, agent memory) persists in SQLite. No in-memory-only state. | Shipped. `SqliteMemoryStore`, `RunStore`, `ChannelStore` all write to `runtime.db`. Daemon restart loses no state. | Shipped |
| **Approval-backed mutations** | Every high-stakes action requires explicit human approval before execution. No side-door execution paths. | Shipped. 17 always-require, 33 conditional, 93 exempt. `trigger_agent` removed from chat surfaces. All mutating actions flow through the job queue with approval checks. | Shipped |
| **Worker process isolation** | Workers run in isolated processes with independent failure domains. A crashing worker cannot corrupt the daemon or other workers. | Cooperative isolation with timeouts. Child-process workers (browser, interpreter, files, device, voice, security, social) have process boundaries. In-process workers share the Node.js event loop. Documented in [KNOWN-TRUST-GAPS.md](KNOWN-TRUST-GAPS.md). | Partial |
| **Full channel provenance** | Every artifact delivered to a channel includes complete provenance: source run, generating job, timestamps, and full content for exact replay. | Preview provenance shipped (source run, job type, timestamps). Full content storage is optional -- large artifacts store a summary plus a link to the full output. Exact replay not guaranteed for all artifact types. | Partial |
| **Single inference path** | All LLM inference routes through the runtime kernel's model router. One place to audit, rate-limit, and log all model calls. | Copilot surfaces (`/api/chat/telegram`, `/api/godmode`) maintain their own LLM loops for interactive queries. These are read-only and cannot trigger mutations, but their inference calls do not flow through the kernel's model router. Documented in [ADR-CHAT-SURFACES.md](ADR-CHAT-SURFACES.md). | Partial |
| **Encrypted credentials** | Sensitive credentials (API tokens, webhook secrets, integration keys) stored encrypted at rest. Decrypted only in memory during use. | Not shipped. Credentials stored in plaintext in `~/.jarvis/config.json`. File permissions are the only protection. Encryption at rest is a planned improvement. | Gap |

## Summary

| Status | Count |
|---|---|
| Shipped | 2 |
| Partial | 4 |
| Gap | 1 |

The two fully shipped capabilities (durable state and approval-backed mutations) are the most critical for operational safety. The four partial items have documented exceptions with ADRs or trust-gap entries explaining the rationale. The one gap (encrypted credentials) is a known risk mitigated by filesystem permissions and localhost-only binding.
