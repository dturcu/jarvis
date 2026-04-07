import type { Migration } from "./runner.js";

export const migration0004: Migration = {
  id: "0004",
  name: "channel_fixes",
  sql: `
-- ============================================================
-- Channel fixes: enforce unique (channel, external_id) on threads
-- Prevents race conditions from creating duplicate threads for
-- the same external conversation.
-- ============================================================

DROP INDEX IF EXISTS idx_channel_threads_ext;
CREATE UNIQUE INDEX idx_channel_threads_ext ON channel_threads(channel, external_id);
`,
};
