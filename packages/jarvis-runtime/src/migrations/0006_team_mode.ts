import type { Migration } from "./runner.js";
import { columnExists, indexExists } from "./schema.js";

export const migration0006: Migration = {
  id: "0006",
  name: "team_mode",
  sql: `
-- ============================================================
-- Small-team mode: ownership and delegation for runs/approvals.
-- Enables multiple trusted operators on a single Jarvis node.
-- ============================================================

-- Add owner and assignee to runs
ALTER TABLE runs ADD COLUMN owner TEXT;
ALTER TABLE runs ADD COLUMN assignee TEXT;

-- Add assignee and delegated_by to approvals
ALTER TABLE approvals ADD COLUMN assignee TEXT;
ALTER TABLE approvals ADD COLUMN delegated_by TEXT;
ALTER TABLE approvals ADD COLUMN delegation_note TEXT;

-- Team activity timeline index
CREATE INDEX IF NOT EXISTS idx_runs_owner ON runs(owner);
CREATE INDEX IF NOT EXISTS idx_runs_assignee ON runs(assignee);
CREATE INDEX IF NOT EXISTS idx_approvals_assignee ON approvals(assignee);
`,
  isApplied: (db) =>
    columnExists(db, "runs", "owner")
    && columnExists(db, "runs", "assignee")
    && columnExists(db, "approvals", "assignee")
    && columnExists(db, "approvals", "delegated_by")
    && columnExists(db, "approvals", "delegation_note")
    && indexExists(db, "idx_runs_owner")
    && indexExists(db, "idx_runs_assignee")
    && indexExists(db, "idx_approvals_assignee"),
};
