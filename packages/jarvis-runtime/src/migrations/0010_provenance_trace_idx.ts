import type { Migration } from "./runner.js";

export const migration0010: Migration = {
  id: "0010",
  name: "provenance_trace_index",
  sql: `
-- Index on trace_id for OpenTelemetry correlation queries.
-- Allows efficient lookup of all provenance records for a given trace.
CREATE INDEX IF NOT EXISTS idx_prov_trace ON provenance_traces(trace_id);
`,
};
