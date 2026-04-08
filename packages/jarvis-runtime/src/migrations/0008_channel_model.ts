import type { Migration } from "./runner.js";

export const migration0008: Migration = {
  id: "0008",
  name: "channel_model",
  sql: `
-- ============================================================
-- Channel model completion: thread status, delivery attempts,
-- approval linking, and thread-aware queries.
-- ============================================================

-- #43: Thread status — track lifecycle of channel threads
ALTER TABLE channel_threads ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'resolved', 'archived'));
CREATE INDEX idx_channel_threads_status ON channel_threads(status);
CREATE INDEX idx_channel_threads_channel_status ON channel_threads(channel, status);

-- #44: Delivery attempts — retry tracking for outbound deliveries
CREATE TABLE delivery_attempts (
  attempt_id   TEXT PRIMARY KEY,
  delivery_id  TEXT NOT NULL REFERENCES artifact_deliveries(delivery_id),
  attempted_at TEXT NOT NULL,
  success      INTEGER NOT NULL DEFAULT 0,
  error        TEXT
);
CREATE INDEX idx_delivery_attempts_delivery ON delivery_attempts(delivery_id);

-- #45: Link approvals to channel messages
ALTER TABLE channel_messages ADD COLUMN approval_id TEXT;
CREATE INDEX idx_channel_messages_approval ON channel_messages(approval_id);
`,
};
