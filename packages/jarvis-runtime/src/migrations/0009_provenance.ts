import type { Migration } from "./runner.js";

export const migration0009: Migration = {
  id: "0009",
  name: "provenance_traces",
  sql: `
-- ============================================================
-- Provenance traces for regulated audit compliance.
-- Each high-stakes job produces a signed provenance record
-- with HMAC-SHA256 signature, chained via prev_signature
-- for gap detection. Suitable for ISO 26262 tool qualification.
-- ============================================================

CREATE TABLE IF NOT EXISTS provenance_traces (
  record_id       TEXT PRIMARY KEY,
  job_id          TEXT NOT NULL,
  job_type        TEXT NOT NULL,
  agent_id        TEXT,
  run_id          TEXT,
  input_hash      TEXT NOT NULL,
  output_hash     TEXT NOT NULL,
  trace_id        TEXT,
  sequence        INTEGER NOT NULL,
  prev_signature  TEXT,
  signature       TEXT NOT NULL,
  signed_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_prov_job ON provenance_traces(job_id);
CREATE INDEX IF NOT EXISTS idx_prov_agent ON provenance_traces(agent_id);
CREATE INDEX IF NOT EXISTS idx_prov_run ON provenance_traces(run_id);
CREATE INDEX IF NOT EXISTS idx_prov_sequence ON provenance_traces(run_id, sequence);
`,
};
