import type { Migration } from "./runner.js";

export const migration0001: Migration = {
  id: "0001",
  name: "runtime_core",
  sql: `
-- ============================================================
-- Jarvis runtime control-plane schema
-- 12 tables covering approvals, commands, runs, heartbeats,
-- notifications, plugins, audit, settings, models, schedules,
-- and agent memory.
-- ============================================================

-- Approvals (replaces approvals.json)
CREATE TABLE approvals (
  approval_id   TEXT PRIMARY KEY,
  run_id        TEXT,
  agent_id      TEXT,
  step_no       INTEGER,
  action        TEXT NOT NULL,
  severity      TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  payload_json  TEXT,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  requested_at  TEXT NOT NULL,
  resolved_at   TEXT,
  resolved_by   TEXT,
  resolution_note TEXT
);
CREATE INDEX idx_approvals_run_id ON approvals(run_id);
CREATE INDEX idx_approvals_status ON approvals(status);

-- Agent commands (replaces trigger-*.json files)
CREATE TABLE agent_commands (
  command_id        TEXT PRIMARY KEY,
  command_type      TEXT NOT NULL,
  target_agent_id   TEXT,
  target_run_id     TEXT,
  payload_json      TEXT,
  status            TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'claimed', 'completed', 'failed', 'cancelled')),
  priority          INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  claimed_at        TEXT,
  completed_at      TEXT,
  created_by        TEXT,
  idempotency_key   TEXT UNIQUE
);
CREATE INDEX idx_agent_commands_status_priority ON agent_commands(status, priority DESC);

-- Run events (enables replayable execution history)
CREATE TABLE run_events (
  event_id      TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL,
  agent_id      TEXT,
  event_type    TEXT NOT NULL,
  step_no       INTEGER,
  action        TEXT,
  payload_json  TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_run_events_run_id ON run_events(run_id);

-- Daemon heartbeats (replaces daemon-status.json)
CREATE TABLE daemon_heartbeats (
  daemon_id       TEXT PRIMARY KEY,
  pid             INTEGER,
  host            TEXT,
  version         TEXT,
  status          TEXT,
  last_seen_at    TEXT NOT NULL,
  current_run_id  TEXT,
  current_agent_id TEXT,
  details_json    TEXT
);

-- Notifications (replaces telegram-queue.json)
CREATE TABLE notifications (
  notification_id TEXT PRIMARY KEY,
  channel         TEXT NOT NULL,
  kind            TEXT,
  payload_json    TEXT,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  created_at      TEXT NOT NULL,
  delivered_at    TEXT
);
CREATE INDEX idx_notifications_status ON notifications(status);

-- Plugin installs
CREATE TABLE plugin_installs (
  plugin_id     TEXT PRIMARY KEY,
  version       TEXT,
  install_path  TEXT,
  installed_at  TEXT NOT NULL,
  installed_by  TEXT,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'failed')),
  manifest_json TEXT
);

-- Audit log
CREATE TABLE audit_log (
  audit_id      TEXT PRIMARY KEY,
  actor_type    TEXT NOT NULL,
  actor_id      TEXT,
  action        TEXT NOT NULL,
  target_type   TEXT,
  target_id     TEXT,
  payload_json  TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_audit_log_created_at ON audit_log(created_at);

-- Settings
CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value_json  TEXT,
  updated_at  TEXT NOT NULL
);

-- Model registry (populated by Phase 4 model discovery)
CREATE TABLE model_registry (
  model_id          TEXT PRIMARY KEY,
  runtime           TEXT,
  capabilities_json TEXT,
  limits_json       TEXT,
  tags_json         TEXT,
  discovered_at     TEXT,
  last_seen_at      TEXT,
  enabled           INTEGER NOT NULL DEFAULT 1
);

-- Model benchmarks (populated by Phase 4 benchmarking)
CREATE TABLE model_benchmarks (
  benchmark_id      TEXT PRIMARY KEY,
  model_id          TEXT NOT NULL,
  runtime           TEXT,
  benchmark_type    TEXT,
  latency_ms        REAL,
  tokens_per_sec    REAL,
  json_success      REAL,
  tool_call_success REAL,
  notes_json        TEXT,
  measured_at       TEXT NOT NULL
);

-- Schedules (replaces in-memory SchedulerStore Map)
CREATE TABLE schedules (
  schedule_id     TEXT PRIMARY KEY,
  job_type        TEXT NOT NULL,
  input_json      TEXT,
  cron_expression TEXT,
  next_fire_at    TEXT,
  enabled         INTEGER NOT NULL DEFAULT 1,
  scope_group     TEXT,
  label           TEXT,
  created_at      TEXT NOT NULL,
  last_fired_at   TEXT
);
CREATE INDEX idx_schedules_next_fire ON schedules(next_fire_at, enabled);

-- Agent memory (replaces in-memory AgentMemoryStore Maps)
CREATE TABLE agent_memory (
  memory_id   TEXT PRIMARY KEY,
  agent_id    TEXT NOT NULL,
  memory_type TEXT NOT NULL CHECK (memory_type IN ('short_term', 'long_term')),
  key         TEXT NOT NULL,
  value_json  TEXT,
  created_at  TEXT NOT NULL,
  expires_at  TEXT
);
CREATE INDEX idx_agent_memory_agent_type ON agent_memory(agent_id, memory_type);
`,
};
