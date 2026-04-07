import type { Migration } from "./runner.js";

export const migration0004: Migration = {
  id: "0004",
  name: "channel_fixes",
  sql: `
-- ============================================================
-- Channel fixes: enforce unique (channel, external_id) on threads
-- Prevents race conditions from creating duplicate threads for
-- the same external conversation.
--
-- Step 1: Deduplicate any existing duplicate threads by keeping
-- the oldest row per (channel, external_id) pair and reassigning
-- messages/deliveries from duplicates to the kept thread.
-- Step 2: Delete the duplicate thread rows.
-- Step 3: Replace the non-unique index with a UNIQUE index.
-- ============================================================

-- Reassign channel_messages from duplicate threads to the canonical (oldest) thread
UPDATE channel_messages SET thread_id = (
  SELECT t2.thread_id FROM channel_threads t2
  WHERE t2.channel = (SELECT channel FROM channel_threads WHERE thread_id = channel_messages.thread_id)
    AND t2.external_id = (SELECT external_id FROM channel_threads WHERE thread_id = channel_messages.thread_id)
  ORDER BY t2.created_at ASC LIMIT 1
)
WHERE thread_id IN (
  SELECT t.thread_id FROM channel_threads t
  WHERE EXISTS (
    SELECT 1 FROM channel_threads t2
    WHERE t2.channel = t.channel AND t2.external_id = t.external_id
      AND t2.created_at < t.created_at
  )
);

-- Reassign artifact_deliveries from duplicate threads
UPDATE artifact_deliveries SET thread_id = (
  SELECT t2.thread_id FROM channel_threads t2
  WHERE t2.channel = (SELECT channel FROM channel_threads WHERE thread_id = artifact_deliveries.thread_id)
    AND t2.external_id = (SELECT external_id FROM channel_threads WHERE thread_id = artifact_deliveries.thread_id)
  ORDER BY t2.created_at ASC LIMIT 1
)
WHERE thread_id IS NOT NULL AND thread_id IN (
  SELECT t.thread_id FROM channel_threads t
  WHERE EXISTS (
    SELECT 1 FROM channel_threads t2
    WHERE t2.channel = t.channel AND t2.external_id = t.external_id
      AND t2.created_at < t.created_at
  )
);

-- Delete duplicate thread rows (keep oldest per channel+external_id)
DELETE FROM channel_threads WHERE thread_id IN (
  SELECT t.thread_id FROM channel_threads t
  WHERE EXISTS (
    SELECT 1 FROM channel_threads t2
    WHERE t2.channel = t.channel AND t2.external_id = t.external_id
      AND t2.created_at < t.created_at
  )
);

DROP INDEX IF EXISTS idx_channel_threads_ext;
CREATE UNIQUE INDEX idx_channel_threads_ext ON channel_threads(channel, external_id);
`,
};
