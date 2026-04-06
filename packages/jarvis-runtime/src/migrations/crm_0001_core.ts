import type { Migration } from "./runner.js";

export const crmMigration0001: Migration = {
  id: "0001",
  name: "crm_core",
  sql: `
-- ============================================================
-- CRM database schema — contacts, notes, stage history, campaigns
-- ============================================================

CREATE TABLE IF NOT EXISTS contacts (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  company     TEXT NOT NULL,
  role        TEXT,
  email       TEXT,
  linkedin_url TEXT,
  source      TEXT,
  score       INTEGER DEFAULT 0,
  stage       TEXT DEFAULT 'prospect',
  tags        TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
  id          TEXT PRIMARY KEY,
  contact_id  TEXT REFERENCES contacts(id),
  note        TEXT,
  note_type   TEXT DEFAULT 'general',
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stage_history (
  id          TEXT PRIMARY KEY,
  contact_id  TEXT REFERENCES contacts(id),
  from_stage  TEXT,
  to_stage    TEXT,
  moved_at    TEXT NOT NULL,
  note        TEXT
);

-- Campaigns (email drip sequences)
CREATE TABLE IF NOT EXISTS campaigns (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL DEFAULT 'cold_outreach',
  status          TEXT NOT NULL DEFAULT 'draft',
  sequence_count  INTEGER NOT NULL DEFAULT 3,
  delay_days      INTEGER NOT NULL DEFAULT 4,
  subject_template TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS campaign_recipients (
  campaign_id   TEXT NOT NULL,
  contact_id    TEXT NOT NULL,
  email         TEXT NOT NULL,
  current_step  INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'enrolled',
  enrolled_at   TEXT NOT NULL,
  last_sent_at  TEXT,
  last_status_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, contact_id),
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
);
CREATE INDEX IF NOT EXISTS idx_recipients_campaign ON campaign_recipients(campaign_id);
CREATE INDEX IF NOT EXISTS idx_recipients_status ON campaign_recipients(status);
`,
};
