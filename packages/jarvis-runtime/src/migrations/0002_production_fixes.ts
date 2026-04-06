import type { Migration } from "./runner.js";

export const migration0002: Migration = {
  id: "0002",
  name: "production_fixes",
  sql: `
-- ============================================================
-- Production fixes: durable runs, model registry composite key,
-- plugin status constraint, entity provenance in knowledge.db
-- ============================================================

-- 1. Durable runs table — authoritative current state of each agent run
CREATE TABLE runs (
  run_id      TEXT PRIMARY KEY,
  agent_id    TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','planning','executing','awaiting_approval','completed','failed','cancelled')),
  trigger_kind TEXT,
  command_id  TEXT,
  goal        TEXT,
  total_steps INTEGER,
  current_step INTEGER DEFAULT 0,
  error       TEXT,
  started_at  TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX idx_runs_agent_id ON runs(agent_id);
CREATE INDEX idx_runs_status ON runs(status);

-- 2. Recreate model_registry with composite PK (runtime, model_id)
--    Fixes key collision when same model name exists in Ollama and LM Studio
CREATE TABLE model_registry_v2 (
  model_id          TEXT NOT NULL,
  runtime           TEXT NOT NULL,
  capabilities_json TEXT,
  limits_json       TEXT,
  tags_json         TEXT,
  discovered_at     TEXT,
  last_seen_at      TEXT,
  enabled           INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (runtime, model_id)
);
INSERT INTO model_registry_v2
  SELECT model_id, COALESCE(runtime, 'unknown'), capabilities_json, limits_json, tags_json,
         discovered_at, last_seen_at, enabled
  FROM model_registry;
DROP TABLE model_registry;
ALTER TABLE model_registry_v2 RENAME TO model_registry;

-- 3. Recreate plugin_installs with 'uninstalled' in CHECK constraint
CREATE TABLE plugin_installs_v2 (
  plugin_id     TEXT PRIMARY KEY,
  version       TEXT,
  install_path  TEXT,
  installed_at  TEXT NOT NULL,
  installed_by  TEXT,
  status        TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','disabled','failed','uninstalled')),
  manifest_json TEXT
);
INSERT INTO plugin_installs_v2 SELECT * FROM plugin_installs;
DROP TABLE plugin_installs;
ALTER TABLE plugin_installs_v2 RENAME TO plugin_installs;
`,
};
