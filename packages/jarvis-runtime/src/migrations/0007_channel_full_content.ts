import type { Migration } from "./runner.js";

export const migration0007: Migration = {
  id: "0007",
  name: "channel_full_content",
  sql: `
-- ============================================================
-- Full message content storage for forensic replay and
-- conversational provenance. The existing content_preview
-- column (truncated to 500 chars) is kept for listing views.
-- ============================================================

ALTER TABLE channel_messages ADD COLUMN content_full TEXT;
`,
};
