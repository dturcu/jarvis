import type { Migration } from "./runner.js";

export const migration0005: Migration = {
  id: "0005",
  name: "knowledge_links",
  sql: `
-- ============================================================
-- Knowledge links: decision-to-entity linking and dedup support.
-- Enables traversal from decisions to the entities they affect,
-- and canonical key normalization for better deduplication.
-- ============================================================

-- Links decisions to the entities they affect
CREATE TABLE IF NOT EXISTS decision_entity_links (
  link_id       TEXT PRIMARY KEY,
  decision_id   TEXT NOT NULL,
  entity_id     TEXT NOT NULL,
  link_type     TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_del_decision ON decision_entity_links(decision_id);
CREATE INDEX IF NOT EXISTS idx_del_entity ON decision_entity_links(entity_id);

-- Canonical key normalization log for dedup auditing
CREATE TABLE IF NOT EXISTS canonical_aliases (
  alias_id      TEXT PRIMARY KEY,
  canonical_key TEXT NOT NULL,
  alias_key     TEXT NOT NULL,
  entity_type   TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ca_canonical ON canonical_aliases(canonical_key);
CREATE INDEX IF NOT EXISTS idx_ca_alias ON canonical_aliases(alias_key);
`,
};
