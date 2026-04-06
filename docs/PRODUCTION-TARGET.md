# Production Target

## Deployment Model

Jarvis runs as a **single-node local appliance** on one EVO-X2 Windows machine. There is no cluster, no container orchestration, no cloud-first deployment path. The system boots, runs, backs up, and recovers on the same physical box.

## Trust Boundaries

| Boundary | Trust Level |
|---|---|
| Operator (Daniel / small trusted team) | Full trust. Can approve, reject, configure, and override. |
| Local LLM runtime (Ollama / LM Studio) | Trusted infrastructure. Runs on the same machine. |
| Dashboard / API | Authenticated. Localhost-bound by default. LAN-bindable with explicit config. |
| Webhooks | Authenticated (HMAC or token). Never anonymous in production. |
| External APIs (Gmail, Calendar, Drive, Telegram) | Trusted-with-credentials. Scoped by OAuth grants. |
| Agent outputs (emails, posts, proposals) | Untrusted until human-reviewed. High-stakes outputs are draft-only until operator marks accepted. |
| Plugin code | Semi-trusted. Must declare permissions. Cannot access undeclared capabilities. |

## Operator Model

- One operator or one small trusted team.
- All high-stakes outputs (email sends, social posts, trade executions, compliance signoffs) require human approval before execution.
- The operator controls agent schedules, approval gates, model routing policy, and plugin lifecycle.
- The system never takes irreversible external action without explicit human gate.

## Inference Model

- **Local models are the default.** Ollama and LM Studio are the supported runtimes.
- External inference providers (Claude, OpenAI, etc.) are **optional and disabled by default**.
- External escalation requires explicit policy configuration. There is no automatic fallback to cloud providers.
- Model routing is policy-based (TaskProfile + SelectionPolicy), not provider-shaped. No haiku/sonnet/opus abstractions.

## Network Surface

- Dashboard and API bind to **localhost by default**.
- LAN bind is available via explicit configuration only.
- No public internet exposure. No reverse proxy configuration is part of the core system.
- CORS is restricted to configured origins.

## Data Sovereignty

- All databases (runtime.db, crm.db, knowledge.db) are local SQLite files.
- All agent memory, entity graphs, decision logs, and run events are stored locally.
- Backups are local snapshots. No cloud sync.
- Secrets are stored locally (config file or encrypted local store). No external secret manager.

## Non-Goals

These are explicitly out of scope for this system:

- **Multi-tenant hosting.** Jarvis serves one operator/team, not multiple isolated customers.
- **Cloud-first deployment.** No AWS/GCP/Azure assumptions. No Terraform. No Kubernetes.
- **Distributed systems.** No PostgreSQL, no Redis, no message queues, no service mesh.
- **Automatic cloud provider fallback.** No "confidence-based" escalation to Claude/OpenAI.
- **Fully autonomous safety/compliance signoff.** ISO 26262 and legal outputs always require human review.
- **Public API.** The control surface is for the operator, not for external consumers.
- **Mobile app or native client.** The dashboard is a web UI served locally.

## What "Production Ready" Means

The system is production ready when:

1. The box can reboot and recover cleanly (durable state, migration-safe startup).
2. Agent runs are durable and inspectable (DB-backed run lifecycle, event trail).
3. Every approval, rejection, and manual action is audited.
4. Model routing is policy-based, not provider-shaped.
5. Risky workers are isolated (browser, interpreter, filesystem).
6. A failed model, browser session, or worker does not corrupt runtime state.
7. Backups and restores are tested and work end-to-end.
8. High-stakes flows cannot bypass human review.
9. The system is safe to leave running continuously on one local node.
