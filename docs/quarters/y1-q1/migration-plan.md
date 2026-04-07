# Y1-Q1 Kernel Unification — Migration Plan

## New Tables

### `channel_threads`

Tracks conversation threads across channels (Telegram, email, dashboard).

```sql
CREATE TABLE channel_threads (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,        -- 'telegram' | 'email' | 'dashboard' | 'webhook'
  external_id TEXT,             -- channel-specific thread ID
  subject TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### `channel_messages`

Individual messages within a channel thread.

```sql
CREATE TABLE channel_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES channel_threads(id),
  channel TEXT NOT NULL,
  external_id TEXT,             -- channel-specific message ID
  direction TEXT NOT NULL,      -- 'inbound' | 'outbound'
  content_type TEXT,
  content_preview TEXT,
  sender TEXT,
  created_at TEXT NOT NULL
);
```

### `artifact_deliveries`

Links artifacts to their delivery via channels.

```sql
CREATE TABLE artifact_deliveries (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL,
  thread_id TEXT REFERENCES channel_threads(id),
  message_id TEXT REFERENCES channel_messages(id),
  channel TEXT NOT NULL,
  delivered_at TEXT NOT NULL,
  status TEXT NOT NULL          -- 'pending' | 'delivered' | 'failed'
);
```

## Indexes

```sql
CREATE INDEX idx_channel_threads_channel ON channel_threads(channel);
CREATE INDEX idx_channel_messages_thread ON channel_messages(thread_id);
CREATE INDEX idx_artifact_deliveries_artifact ON artifact_deliveries(artifact_id);
```

## Migration Script

File: `packages/jarvis-runtime/src/migrations/0003_channel_persistence.ts`

## Rollback

All three tables are new additions with no data dependencies on existing tables. Rollback is a clean drop:

```sql
DROP TABLE IF EXISTS artifact_deliveries;
DROP TABLE IF EXISTS channel_messages;
DROP TABLE IF EXISTS channel_threads;
```

No existing data is altered. Rollback is non-destructive to prior state.

## Doctor Checks

Add to doctor:
- Verify `channel_threads` table exists
- Verify `channel_messages` table exists
- Verify `artifact_deliveries` table exists
- Verify foreign key constraints are intact
- Verify indexes exist
