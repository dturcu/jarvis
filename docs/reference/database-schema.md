# Jarvis Database Schema Reference

> Full column-level schema for all three SQLite databases.
> Generated from migration source files: 2026-04-10

All databases use WAL mode and 5s busy timeout:
```sql
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
```

---

## runtime.db (Control Plane)

**Path:** `~/.jarvis/runtime.db`
**Migrations:** 11 (0001-0011)

### runs

Authoritative current state of agent runs.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `run_id` | TEXT | PRIMARY KEY | UUID |
| `agent_id` | TEXT | NOT NULL | Agent definition ID |
| `status` | TEXT | NOT NULL DEFAULT 'queued', CHECK IN (queued, planning, executing, awaiting_approval, completed, failed, cancelled) | Run state |
| `trigger_kind` | TEXT | | Trigger type (manual, schedule, event, threshold) |
| `command_id` | TEXT | | Source command |
| `goal` | TEXT | | Run goal description |
| `total_steps` | INTEGER | | Plan step count |
| `current_step` | INTEGER | DEFAULT 0 | Current execution step |
| `error` | TEXT | | Error message if failed |
| `started_at` | TEXT | NOT NULL | ISO timestamp |
| `completed_at` | TEXT | | ISO timestamp |
| `owner` | TEXT | | Delegating operator |
| `assignee` | TEXT | | Assigned operator |

**Indexes:** `idx_runs_agent_id`, `idx_runs_status`, `idx_runs_owner`, `idx_runs_assignee`

### approvals

Approval state machine for gated actions.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `approval_id` | TEXT | PRIMARY KEY | UUID |
| `run_id` | TEXT | | Associated run |
| `agent_id` | TEXT | | Agent requesting approval |
| `step_no` | INTEGER | | Step number in plan |
| `action` | TEXT | NOT NULL | Action being approved (e.g., "email.send") |
| `severity` | TEXT | NOT NULL, CHECK IN (info, warning, critical) | Risk level |
| `payload_json` | TEXT | | Action payload |
| `status` | TEXT | NOT NULL DEFAULT 'pending', CHECK IN (pending, approved, rejected, expired) | Approval state |
| `requested_at` | TEXT | NOT NULL | ISO timestamp |
| `resolved_at` | TEXT | | Resolution time |
| `resolved_by` | TEXT | | Resolver identity |
| `resolution_note` | TEXT | | Resolution comment |
| `assignee` | TEXT | | Delegated operator |
| `delegated_by` | TEXT | | Who delegated |
| `delegation_note` | TEXT | | Delegation reason |

**Indexes:** `idx_approvals_run_id`, `idx_approvals_status`, `idx_approvals_assignee`

### agent_commands

Durable command queue for agent triggers.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `command_id` | TEXT | PRIMARY KEY | UUID |
| `command_type` | TEXT | NOT NULL | Command type |
| `target_agent_id` | TEXT | | Target agent |
| `target_run_id` | TEXT | | Target run |
| `payload_json` | TEXT | | Command payload |
| `status` | TEXT | NOT NULL DEFAULT 'queued', CHECK IN (queued, claimed, completed, failed, cancelled) | State |
| `priority` | INTEGER | NOT NULL DEFAULT 0 | Priority (higher = first) |
| `created_at` | TEXT | NOT NULL | ISO timestamp |
| `claimed_at` | TEXT | | Claim time |
| `completed_at` | TEXT | | Completion time |
| `created_by` | TEXT | | Source identity |
| `idempotency_key` | TEXT | UNIQUE | Dedup key |

**Indexes:** `idx_agent_commands_status_priority (status, priority DESC)`

### run_events

Immutable audit trail for run execution.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `event_id` | TEXT | PRIMARY KEY | UUID |
| `run_id` | TEXT | NOT NULL | Parent run |
| `agent_id` | TEXT | | Agent ID |
| `event_type` | TEXT | NOT NULL | Event type |
| `step_no` | INTEGER | | Plan step |
| `action` | TEXT | | Action name |
| `payload_json` | TEXT | | Event data |
| `created_at` | TEXT | NOT NULL | ISO timestamp |

**Indexes:** `idx_run_events_run_id`

### daemon_heartbeats

Daemon liveness tracking (UPSERT every 10s).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `daemon_id` | TEXT | PRIMARY KEY | Daemon instance ID |
| `pid` | INTEGER | | Process ID |
| `host` | TEXT | | Hostname |
| `version` | TEXT | | Jarvis version |
| `status` | TEXT | | Daemon status |
| `last_seen_at` | TEXT | NOT NULL | Last heartbeat time |
| `current_run_id` | TEXT | | Active run |
| `current_agent_id` | TEXT | | Active agent |
| `details_json` | TEXT | | StatusWriter payload |

### notifications

Outbound notification queue.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `notification_id` | TEXT | PRIMARY KEY | UUID |
| `channel` | TEXT | NOT NULL | Target channel (telegram, dashboard) |
| `kind` | TEXT | | Notification type |
| `payload_json` | TEXT | | Content |
| `status` | TEXT | NOT NULL DEFAULT 'pending', CHECK IN (pending, sent, failed) | State |
| `created_at` | TEXT | NOT NULL | ISO timestamp |
| `delivered_at` | TEXT | | Delivery time |

**Indexes:** `idx_notifications_status`

### schedules

Durable cron schedules (survives restart).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `schedule_id` | TEXT | PRIMARY KEY | UUID |
| `job_type` | TEXT | NOT NULL | Job to fire |
| `input_json` | TEXT | | Job input |
| `cron_expression` | TEXT | | 5-field cron |
| `next_fire_at` | TEXT | | Next fire time |
| `enabled` | INTEGER | NOT NULL DEFAULT 1 | Active flag |
| `scope_group` | TEXT | | Schedule group |
| `label` | TEXT | | Human label |
| `created_at` | TEXT | NOT NULL | ISO timestamp |
| `last_fired_at` | TEXT | | Last fire time |

**Indexes:** `idx_schedules_next_fire (next_fire_at, enabled)`

### agent_memory

Per-agent persistent memory.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `memory_id` | TEXT | PRIMARY KEY | UUID |
| `agent_id` | TEXT | NOT NULL | Owner agent |
| `memory_type` | TEXT | NOT NULL, CHECK IN (short_term, long_term) | Memory kind |
| `key` | TEXT | NOT NULL | Memory key |
| `value_json` | TEXT | | Memory value |
| `created_at` | TEXT | NOT NULL | ISO timestamp |
| `expires_at` | TEXT | | Expiry (short_term) |

**Indexes:** `idx_agent_memory_agent_type (agent_id, memory_type)`

### audit_log

Security-sensitive action trail.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `audit_id` | TEXT | PRIMARY KEY | UUID |
| `actor_type` | TEXT | NOT NULL | "dashboard", "webhook", "telegram" |
| `actor_id` | TEXT | | e.g., "admin:abcd" |
| `action` | TEXT | NOT NULL | e.g., "approval.approved" |
| `target_type` | TEXT | | Resource type |
| `target_id` | TEXT | | Resource ID |
| `payload_json` | TEXT | | Context data |
| `created_at` | TEXT | NOT NULL | ISO timestamp |

**Indexes:** `idx_audit_log_created_at`

### settings

Runtime-configurable key-value settings.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `key` | TEXT | PRIMARY KEY | Setting key |
| `value_json` | TEXT | | JSON value |
| `updated_at` | TEXT | NOT NULL | Last update |

### plugin_installs

Plugin lifecycle tracking.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `plugin_id` | TEXT | PRIMARY KEY | Plugin identifier |
| `version` | TEXT | | Installed version |
| `install_path` | TEXT | | Filesystem path |
| `installed_at` | TEXT | NOT NULL | Install time |
| `installed_by` | TEXT | | Installer identity |
| `status` | TEXT | NOT NULL DEFAULT 'active', CHECK IN (active, disabled, failed, uninstalled) | State |
| `manifest_json` | TEXT | | Plugin manifest |

### model_registry

Discovered local LLM models.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `model_id` | TEXT | NOT NULL | Model identifier |
| `runtime` | TEXT | NOT NULL | Runtime (lmstudio, ollama, openclaw) |
| `capabilities_json` | TEXT | | Model capabilities |
| `limits_json` | TEXT | | Model limits |
| `tags_json` | TEXT | | Tags |
| `discovered_at` | TEXT | | First discovery |
| `last_seen_at` | TEXT | | Last seen |
| `enabled` | INTEGER | NOT NULL DEFAULT 1 | Active flag |

**Primary Key:** `(runtime, model_id)` composite

### model_benchmarks

Cached benchmark results.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `benchmark_id` | TEXT | PRIMARY KEY | UUID |
| `model_id` | TEXT | NOT NULL | Model tested |
| `runtime` | TEXT | | Runtime |
| `benchmark_type` | TEXT | | Benchmark type |
| `latency_ms` | REAL | | Response latency |
| `tokens_per_sec` | REAL | | Generation speed |
| `json_success` | REAL | | JSON output success rate |
| `tool_call_success` | REAL | | Tool call success rate |
| `notes_json` | TEXT | | Additional notes |
| `measured_at` | TEXT | NOT NULL | Measurement time |

### channel_threads

Message thread tracking for multi-platform communication.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `thread_id` | TEXT | PRIMARY KEY | UUID |
| `channel` | TEXT | NOT NULL | Channel (telegram, web, api) |
| `external_id` | TEXT | | Platform thread ID |
| `subject` | TEXT | | Thread subject |
| `metadata_json` | TEXT | | Additional metadata |
| `created_at` | TEXT | NOT NULL | ISO timestamp |
| `updated_at` | TEXT | NOT NULL | ISO timestamp |
| `status` | TEXT | NOT NULL DEFAULT 'active', CHECK IN (active, resolved, archived) | Thread state |

**Indexes:** `idx_channel_threads_channel`, `idx_channel_threads_ext (channel, external_id) UNIQUE`, `idx_channel_threads_status`, `idx_channel_threads_channel_status`

### channel_messages

Individual messages within threads.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `message_id` | TEXT | PRIMARY KEY | UUID |
| `thread_id` | TEXT | NOT NULL, FK channel_threads | Parent thread |
| `channel` | TEXT | NOT NULL | Channel |
| `external_id` | TEXT | | Platform message ID |
| `direction` | TEXT | NOT NULL, CHECK IN (inbound, outbound) | Message direction |
| `content_preview` | TEXT | | Truncated preview |
| `content_full` | TEXT | | Full message content |
| `sender` | TEXT | | Sender identity |
| `command_id` | TEXT | | Linked command |
| `run_id` | TEXT | | Linked run |
| `approval_id` | TEXT | | Linked approval |
| `created_at` | TEXT | NOT NULL | ISO timestamp |

**Indexes:** `idx_channel_messages_thread`, `idx_channel_messages_command`, `idx_channel_messages_run`, `idx_channel_messages_approval`

### artifact_deliveries

Track artifact delivery to channels.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `delivery_id` | TEXT | PRIMARY KEY | UUID |
| `run_id` | TEXT | NOT NULL | Source run |
| `thread_id` | TEXT | FK channel_threads | Target thread |
| `message_id` | TEXT | FK channel_messages | Delivery message |
| `channel` | TEXT | NOT NULL | Channel |
| `artifact_type` | TEXT | | Artifact type |
| `content_preview` | TEXT | | Preview |
| `status` | TEXT | NOT NULL DEFAULT 'pending', CHECK IN (pending, delivered, failed) | State |
| `delivered_at` | TEXT | | Delivery time |
| `created_at` | TEXT | NOT NULL | ISO timestamp |

**Indexes:** `idx_artifact_deliveries_run`, `idx_artifact_deliveries_thread`

### delivery_attempts

Retry tracking for artifact deliveries.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `attempt_id` | TEXT | PRIMARY KEY | UUID |
| `delivery_id` | TEXT | NOT NULL, FK artifact_deliveries | Parent delivery |
| `attempted_at` | TEXT | NOT NULL | Attempt time |
| `success` | INTEGER | NOT NULL DEFAULT 0 | Success flag |
| `error` | TEXT | | Error message |

**Indexes:** `idx_delivery_attempts_delivery`

### provenance_traces

Regulated audit compliance with HMAC signatures.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `record_id` | TEXT | PRIMARY KEY | UUID |
| `job_id` | TEXT | NOT NULL | Job |
| `job_type` | TEXT | NOT NULL | Job type |
| `agent_id` | TEXT | | Agent |
| `run_id` | TEXT | | Run |
| `input_hash` | TEXT | NOT NULL | SHA-256 of input |
| `output_hash` | TEXT | NOT NULL | SHA-256 of output |
| `trace_id` | TEXT | | Correlation trace |
| `sequence` | INTEGER | NOT NULL | Order in chain |
| `prev_signature` | TEXT | | Previous signature |
| `signature` | TEXT | NOT NULL | HMAC-SHA256 |
| `signed_at` | TEXT | NOT NULL | Signature time |

**Indexes:** `idx_prov_job`, `idx_prov_agent`, `idx_prov_run`, `idx_prov_sequence (run_id, sequence)`, `idx_prov_trace`

### jobs

Job execution tracking.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `job_id` | TEXT | PRIMARY KEY | UUID |
| `run_id` | TEXT | FK runs | Parent run |
| `job_type` | TEXT | NOT NULL | Job type |
| `status` | TEXT | NOT NULL DEFAULT 'queued' | Job state |
| `priority` | INTEGER | NOT NULL DEFAULT 0 | Priority |
| `input_json` | TEXT | | Job input |
| `output_json` | TEXT | | Job result |
| `error_json` | TEXT | | Error details |
| `worker_id` | TEXT | | Executing worker |
| `created_at` | TEXT | NOT NULL DEFAULT datetime('now') | Creation time |
| `claimed_at` | TEXT | | Claim time |
| `completed_at` | TEXT | | Completion time |

**Indexes:** `idx_jobs_run_id`, `idx_jobs_status`

### decision_entity_links

Links decisions to entities for knowledge graph.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `link_id` | TEXT | PRIMARY KEY | UUID |
| `decision_id` | TEXT | NOT NULL | Decision |
| `entity_id` | TEXT | NOT NULL | Entity |
| `link_type` | TEXT | NOT NULL | Relationship type |
| `created_at` | TEXT | NOT NULL | ISO timestamp |

**Indexes:** `idx_del_decision`, `idx_del_entity`

### canonical_aliases

Entity name aliases for deduplication.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `alias_id` | TEXT | PRIMARY KEY | UUID |
| `canonical_key` | TEXT | NOT NULL | Canonical entity key |
| `alias_key` | TEXT | NOT NULL | Alternative name |
| `entity_type` | TEXT | NOT NULL | Entity type |
| `created_at` | TEXT | NOT NULL | ISO timestamp |

**Indexes:** `idx_ca_canonical`, `idx_ca_alias`

---

## crm.db (CRM Pipeline)

**Path:** `~/.jarvis/crm.db`
**Migrations:** 1 (crm_0001)

### contacts

Sales pipeline contacts.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY | UUID |
| `name` | TEXT | NOT NULL | Full name |
| `company` | TEXT | NOT NULL | Company name |
| `role` | TEXT | | Job title |
| `email` | TEXT | | Email address |
| `linkedin_url` | TEXT | | LinkedIn URL |
| `source` | TEXT | | Lead source |
| `score` | INTEGER | DEFAULT 0 | Engagement score (0-100) |
| `stage` | TEXT | DEFAULT 'prospect' | Pipeline stage |
| `tags` | TEXT | | JSON array of tags |
| `created_at` | TEXT | NOT NULL | ISO timestamp |
| `updated_at` | TEXT | NOT NULL | ISO timestamp |

**Valid stages:** prospect, qualified, contacted, meeting, proposal, negotiation, won, lost, parked

### notes

Contact interaction notes.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY | UUID |
| `contact_id` | TEXT | FK contacts | Parent contact |
| `note` | TEXT | | Note content |
| `note_type` | TEXT | DEFAULT 'general' | call, email, meeting, observation, proposal, general |
| `created_at` | TEXT | NOT NULL | ISO timestamp |

### stage_history

Pipeline stage transitions.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY | UUID |
| `contact_id` | TEXT | FK contacts | Contact |
| `from_stage` | TEXT | | Previous stage |
| `to_stage` | TEXT | | New stage |
| `moved_at` | TEXT | NOT NULL | Transition time |
| `note` | TEXT | | Reason for move |

### campaigns

Email campaign definitions.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY | UUID |
| `name` | TEXT | NOT NULL | Campaign name |
| `type` | TEXT | NOT NULL DEFAULT 'cold_outreach' | Campaign type |
| `status` | TEXT | NOT NULL DEFAULT 'draft' | State |
| `sequence_count` | INTEGER | NOT NULL DEFAULT 3 | Email count in sequence |
| `delay_days` | INTEGER | NOT NULL DEFAULT 4 | Days between emails |
| `subject_template` | TEXT | NOT NULL DEFAULT '' | Subject template |
| `created_at` | TEXT | NOT NULL | ISO timestamp |
| `updated_at` | TEXT | NOT NULL | ISO timestamp |

### campaign_recipients

Campaign enrollment tracking.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `campaign_id` | TEXT | NOT NULL, FK campaigns | Campaign |
| `contact_id` | TEXT | NOT NULL | Contact |
| `email` | TEXT | NOT NULL | Recipient email |
| `current_step` | INTEGER | NOT NULL DEFAULT 0 | Current sequence step |
| `status` | TEXT | NOT NULL DEFAULT 'enrolled' | enrolled, completed, unsubscribed, bounced |
| `enrolled_at` | TEXT | NOT NULL | Enrollment time |
| `last_sent_at` | TEXT | | Last email sent |
| `last_status_at` | TEXT | NOT NULL | Last status change |

**Primary Key:** `(campaign_id, contact_id)` composite
**Indexes:** `idx_recipients_campaign`, `idx_recipients_status`

---

## knowledge.db (Knowledge Store)

**Path:** `~/.jarvis/knowledge.db`
**Migrations:** 1 (knowledge_0001)

### documents

Knowledge documents across 9 collections.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `doc_id` | TEXT | PRIMARY KEY | UUID |
| `collection` | TEXT | NOT NULL | lessons, playbooks, case-studies, contracts, proposals, iso26262, regulatory, meetings, garden |
| `title` | TEXT | NOT NULL | Document title |
| `content` | TEXT | NOT NULL | Full content |
| `tags` | TEXT | | JSON array of tags |
| `source_agent_id` | TEXT | | Creating agent |
| `source_run_id` | TEXT | | Creating run |
| `created_at` | TEXT | NOT NULL | ISO timestamp |
| `updated_at` | TEXT | NOT NULL | ISO timestamp |

### playbooks

Reusable process playbooks.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `playbook_id` | TEXT | PRIMARY KEY | UUID |
| `title` | TEXT | NOT NULL | Playbook title |
| `category` | TEXT | NOT NULL | proposal, objection, delivery, sales, engagement |
| `body` | TEXT | NOT NULL | Playbook content |
| `tags` | TEXT | | JSON array of tags |
| `use_count` | INTEGER | DEFAULT 0 | Usage counter |
| `last_used_at` | TEXT | | Last usage time |
| `created_at` | TEXT | NOT NULL | ISO timestamp |

### entities

Named entities in the knowledge graph.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `entity_id` | TEXT | PRIMARY KEY | UUID |
| `entity_type` | TEXT | NOT NULL | contact, company, document, project, engagement, other |
| `name` | TEXT | NOT NULL | Entity name |
| `canonical_key` | TEXT | UNIQUE | Dedup key |
| `attributes` | TEXT | | JSON attributes |
| `seen_by` | TEXT | | JSON array of agent IDs |
| `created_at` | TEXT | NOT NULL | ISO timestamp |
| `updated_at` | TEXT | NOT NULL | ISO timestamp |

### relations

Entity relationships.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `relation_id` | TEXT | PRIMARY KEY | UUID |
| `from_entity_id` | TEXT | NOT NULL | Source entity |
| `to_entity_id` | TEXT | NOT NULL | Target entity |
| `kind` | TEXT | NOT NULL | works_at, reports_to, related_to, authored, referenced_in, etc. |
| `attributes` | TEXT | | JSON attributes |
| `created_at` | TEXT | NOT NULL | ISO timestamp |

### decisions

Agent decision audit log.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `decision_id` | TEXT | PRIMARY KEY | UUID |
| `agent_id` | TEXT | NOT NULL | Deciding agent |
| `run_id` | TEXT | NOT NULL | Parent run |
| `step` | INTEGER | NOT NULL | Plan step |
| `action` | TEXT | NOT NULL | Action taken |
| `reasoning` | TEXT | NOT NULL | Decision reasoning |
| `outcome` | TEXT | NOT NULL | Result |
| `created_at` | TEXT | NOT NULL | ISO timestamp |

**Indexes:** `idx_decisions_agent`, `idx_decisions_run (agent_id, run_id)`

### entity_provenance

Entity change tracking.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `provenance_id` | TEXT | PRIMARY KEY | UUID |
| `entity_id` | TEXT | NOT NULL | Entity |
| `change_type` | TEXT | NOT NULL | created, updated, merged, deleted |
| `agent_id` | TEXT | NOT NULL | Acting agent |
| `run_id` | TEXT | | Source run |
| `step_no` | INTEGER | | Plan step |
| `action` | TEXT | | Action |
| `changed_at` | TEXT | NOT NULL | ISO timestamp |

**Indexes:** `idx_prov_entity`, `idx_prov_agent`

### memory

Agent memory entries (knowledge.db copy).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `entry_id` | TEXT | PRIMARY KEY | UUID |
| `agent_id` | TEXT | NOT NULL | Agent |
| `run_id` | TEXT | NOT NULL | Run |
| `kind` | TEXT | NOT NULL, CHECK IN (short_term, long_term) | Memory kind |
| `content` | TEXT | NOT NULL | Memory content |
| `created_at` | TEXT | NOT NULL | ISO timestamp |

**Indexes:** `idx_memory_agent (agent_id, kind)`

### embedding_chunks

RAG vector index chunks.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `chunk_id` | TEXT | PRIMARY KEY | UUID |
| `doc_id` | TEXT | NOT NULL | Parent document |
| `chunk_text` | TEXT | NOT NULL | Text chunk |
| `embedding` | BLOB | NOT NULL | Vector embedding |
| `chunk_index` | INTEGER | NOT NULL | Chunk position |
| `created_at` | TEXT | NOT NULL | ISO timestamp |

**Indexes:** `idx_chunks_doc`

### agent_runs (legacy)

Legacy run tracking, kept for backward compatibility.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `run_id` | TEXT | PRIMARY KEY | UUID |
| `agent_id` | TEXT | NOT NULL | Agent |
| `trigger_kind` | TEXT | NOT NULL | Trigger type |
| `trigger_data` | TEXT | | Trigger payload |
| `goal` | TEXT | NOT NULL | Run goal |
| `status` | TEXT | NOT NULL | Run state |
| `current_step` | INTEGER | DEFAULT 0 | Current step |
| `total_steps` | INTEGER | DEFAULT 0 | Total steps |
| `plan_json` | TEXT | | Plan JSON |
| `started_at` | TEXT | NOT NULL | Start time |
| `updated_at` | TEXT | NOT NULL | Last update |
| `completed_at` | TEXT | | Completion time |
| `error` | TEXT | | Error message |

**Indexes:** `idx_runs_agent`
