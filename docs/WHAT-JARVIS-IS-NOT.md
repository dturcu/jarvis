# What Jarvis Is Not

Explicit non-goals and boundaries. Understanding what Jarvis does not do is as important as understanding what it does.

## Not a Multi-Tenant SaaS

Jarvis is a single-operator appliance. There is one operator (Daniel), one set of credentials, one SQLite database cluster. There are no user accounts, no tenant isolation, no subscription billing. It is designed for a team of one running a consulting firm, not for resale.

## Not a Cloud-First Platform

Jarvis is local-first. LLM inference runs on local hardware via Ollama, LM Studio, or llama.cpp. State lives in SQLite files on disk at `~/.jarvis/`. The dashboard binds to localhost. There is no cloud deployment target, no managed infrastructure, no serverless functions. It can run on a single machine with no internet connection (aside from the APIs it integrates with).

## Not a General-Purpose AI Assistant

Jarvis is domain-focused for automotive safety consulting (ISO 26262, ASPICE, AUTOSAR, cybersecurity). Its 14 agents are purpose-built for business development, compliance auditing, proposal generation, and related workflows. It is not a chatbot, not a coding assistant, and not a generic task manager.

## Not a Replacement for Human Judgment

High-stakes decisions are approval-gated. Jarvis will not send an email, publish a post, execute a trade, or move a CRM stage without human approval. Of 144 job types, 17 always require approval and 33 are conditionally gated. The system is designed to surface recommendations, not to act unilaterally on consequential actions.

## Not a Distributed System

Jarvis runs on a single node. State is in SQLite, not Postgres or a distributed database. There is no clustering, no replication, no leader election. The job queue is a table in `runtime.db`, not Kafka or RabbitMQ. This is a deliberate simplicity choice -- a single-operator appliance does not need distributed systems complexity.

## Not a Real-Time System

Jarvis is polling-based and asynchronous. Agents run on cron schedules or on demand. The job queue is polled, not pushed. Workers claim jobs via HTTP request, not via persistent connections. Latency is measured in seconds to minutes, not milliseconds. There is no streaming, no WebSocket push to the dashboard (it polls the REST API).

## Not Fully Process-Isolated

Workers run cooperatively, not in hard-isolated containers. In-process workers share the Node.js event loop with the daemon. Child-process workers (browser, interpreter, files, device, voice, security, social) have process boundaries but share the filesystem. This is a documented trust gap (see [KNOWN-TRUST-GAPS.md](KNOWN-TRUST-GAPS.md)) -- a misbehaving worker can affect the daemon. Hard isolation via containers is a future target, not a shipped capability.
