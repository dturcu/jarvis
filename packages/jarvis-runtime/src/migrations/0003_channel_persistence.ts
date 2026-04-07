import type { Migration } from "./runner.js";

export const migration0003: Migration = {
  id: "0003",
  name: "channel_persistence",
  sql: `
-- ============================================================
-- Channel persistence: threads, messages, and artifact deliveries
-- Enables durable tracking of all channel interactions and
-- links them to the command/run/job pipeline.
-- ============================================================

-- Channel threads — conversation threads across all channels
CREATE TABLE channel_threads (
  thread_id     TEXT PRIMARY KEY,
  channel       TEXT NOT NULL,
  external_id   TEXT,
  subject       TEXT,
  metadata_json TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX idx_channel_threads_channel ON channel_threads(channel);
CREATE INDEX idx_channel_threads_ext ON channel_threads(channel, external_id);

-- Channel messages — individual messages within threads
CREATE TABLE channel_messages (
  message_id      TEXT PRIMARY KEY,
  thread_id       TEXT NOT NULL REFERENCES channel_threads(thread_id),
  channel         TEXT NOT NULL,
  external_id     TEXT,
  direction       TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  content_preview TEXT,
  sender          TEXT,
  command_id      TEXT,
  run_id          TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_channel_messages_thread ON channel_messages(thread_id);
CREATE INDEX idx_channel_messages_command ON channel_messages(command_id);
CREATE INDEX idx_channel_messages_run ON channel_messages(run_id);

-- Artifact deliveries — tracks delivery of run outputs through channels
CREATE TABLE artifact_deliveries (
  delivery_id     TEXT PRIMARY KEY,
  run_id          TEXT NOT NULL,
  thread_id       TEXT REFERENCES channel_threads(thread_id),
  message_id      TEXT REFERENCES channel_messages(message_id),
  channel         TEXT NOT NULL,
  artifact_type   TEXT,
  content_preview TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'delivered', 'failed')),
  delivered_at    TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_artifact_deliveries_run ON artifact_deliveries(run_id);
CREATE INDEX idx_artifact_deliveries_thread ON artifact_deliveries(thread_id);
`,
};
