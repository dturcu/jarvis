import type { Migration } from "./runner.js";

export const knowledgeMigration0001: Migration = {
  id: "0001",
  name: "knowledge_core",
  sql: `
-- ============================================================
-- Knowledge database schema — documents, playbooks, entities,
-- decisions, provenance, memory, runs, vector embeddings
-- ============================================================

-- Documents and playbooks (knowledge base)
CREATE TABLE IF NOT EXISTS documents (
  doc_id          TEXT PRIMARY KEY,
  collection      TEXT NOT NULL,
  title           TEXT NOT NULL,
  content         TEXT NOT NULL,
  tags            TEXT,
  source_agent_id TEXT,
  source_run_id   TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS playbooks (
  playbook_id   TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  category      TEXT NOT NULL,
  body          TEXT NOT NULL,
  tags          TEXT,
  use_count     INTEGER DEFAULT 0,
  last_used_at  TEXT,
  created_at    TEXT NOT NULL
);

-- Entity graph
CREATE TABLE IF NOT EXISTS entities (
  entity_id     TEXT PRIMARY KEY,
  entity_type   TEXT NOT NULL,
  name          TEXT NOT NULL,
  canonical_key TEXT UNIQUE,
  attributes    TEXT,
  seen_by       TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS relations (
  relation_id     TEXT PRIMARY KEY,
  from_entity_id  TEXT NOT NULL,
  to_entity_id    TEXT NOT NULL,
  kind            TEXT NOT NULL,
  attributes      TEXT,
  created_at      TEXT NOT NULL
);

-- Decision log
CREATE TABLE IF NOT EXISTS decisions (
  decision_id TEXT PRIMARY KEY,
  agent_id    TEXT NOT NULL,
  run_id      TEXT NOT NULL,
  step        INTEGER NOT NULL,
  action      TEXT NOT NULL,
  reasoning   TEXT NOT NULL,
  outcome     TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_decisions_agent ON decisions(agent_id);
CREATE INDEX IF NOT EXISTS idx_decisions_run ON decisions(agent_id, run_id);

-- Entity provenance (audit trail for entity changes)
CREATE TABLE IF NOT EXISTS entity_provenance (
  provenance_id TEXT PRIMARY KEY,
  entity_id     TEXT NOT NULL,
  change_type   TEXT NOT NULL,
  agent_id      TEXT NOT NULL,
  run_id        TEXT,
  step_no       INTEGER,
  action        TEXT,
  changed_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prov_entity ON entity_provenance(entity_id);
CREATE INDEX IF NOT EXISTS idx_prov_agent ON entity_provenance(agent_id);

-- Agent memory (short-term and long-term)
CREATE TABLE IF NOT EXISTS memory (
  entry_id    TEXT PRIMARY KEY,
  agent_id    TEXT NOT NULL,
  run_id      TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK(kind IN ('short_term', 'long_term')),
  content     TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memory_agent ON memory(agent_id, kind);

-- Legacy agent runs (kept for backward compat; runtime.db runs table is authoritative)
CREATE TABLE IF NOT EXISTS agent_runs (
  run_id        TEXT PRIMARY KEY,
  agent_id      TEXT NOT NULL,
  trigger_kind  TEXT NOT NULL,
  trigger_data  TEXT,
  goal          TEXT NOT NULL,
  status        TEXT NOT NULL,
  current_step  INTEGER DEFAULT 0,
  total_steps   INTEGER DEFAULT 0,
  plan_json     TEXT,
  started_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  completed_at  TEXT,
  error         TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_agent ON agent_runs(agent_id);

-- Vector embedding chunks (for RAG)
CREATE TABLE IF NOT EXISTS embedding_chunks (
  chunk_id    TEXT PRIMARY KEY,
  doc_id      TEXT NOT NULL,
  chunk_text  TEXT NOT NULL,
  embedding   BLOB NOT NULL,
  chunk_index INTEGER NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunks_doc ON embedding_chunks(doc_id);
`,
};
