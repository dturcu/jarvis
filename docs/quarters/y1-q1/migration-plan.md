# Y1-Q1 Kernel Unification — Migration Plan

## New Tables

### `channel_threads`

Tracks conversation threads across channels (Telegram, email, dashboard).

```sql
CREATE TABLE channel_threads (
  thread_id     TEXT PRIMARY KEY,
  channel       TEXT NOT NULL,        -- 'telegram' | 'email' | 'dashboard' | 'webhook'
  external_id   TEXT,                 -- channel-specific thread ID
  subject       TEXT,
  metadata_json TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
```

### `channel_messages`

Individual messages within a channel thread.

```sql
CREATE TABLE channel_messages (
  message_id      TEXT PRIMARY KEY,
  thread_id       TEXT NOT NULL REFERENCES channel_threads(thread_id),
  channel         TEXT NOT NULL,
  external_id     TEXT,               -- channel-specific message ID
  direction       TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  content_preview TEXT,
  sender          TEXT,
  command_id      TEXT,               -- FK to agent_commands if this message triggered a command
  run_id          TEXT,               -- FK to runs if associated with a run
  created_at      TEXT NOT NULL
);
```

### `artifact_deliveries`

Tracks delivery of run outputs back through channels.

```sql
CREATE TABLE artifact_deliveries (
  delivery_id     TEXT PRIMARY KEY,
  run_id          TEXT NOT NULL,
  thread_id       TEXT REFERENCES channel_threads(thread_id),
  message_id      TEXT REFERENCES channel_messages(message_id),
  channel         TEXT NOT NULL,
  artifact_type   TEXT,               -- 'notification' | 'report' | 'approval_request'
  content_preview TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'delivered', 'failed')),
  delivered_at    TEXT,
  created_at      TEXT NOT NULL
);
```

## Indexes

```sql
CREATE INDEX idx_channel_threads_channel ON channel_threads(channel);
CREATE UNIQUE INDEX idx_channel_threads_ext ON channel_threads(channel, external_id);
CREATE INDEX idx_channel_messages_thread ON channel_messages(thread_id);
CREATE INDEX idx_channel_messages_command ON channel_messages(command_id);
CREATE INDEX idx_channel_messages_run ON channel_messages(run_id);
CREATE INDEX idx_artifact_deliveries_run ON artifact_deliveries(run_id);
CREATE INDEX idx_artifact_deliveries_thread ON artifact_deliveries(thread_id);
```

## Migration Scripts

- `packages/jarvis-runtime/src/migrations/0003_channel_persistence.ts` — creates the three tables
- `packages/jarvis-runtime/src/migrations/0004_channel_fixes.ts` — upgrades `idx_channel_threads_ext` to UNIQUE

## Rollback

All three tables are new additions with no data dependencies on existing tables. Rollback is a clean drop:

```sql
DROP TABLE IF EXISTS artifact_deliveries;
DROP TABLE IF EXISTS channel_messages;
DROP TABLE IF EXISTS channel_threads;
DELETE FROM schema_migrations WHERE id IN ('0003', '0004');
```

No existing data is altered. Rollback is non-destructive to prior state.

## Doctor Checks

Add to doctor:
- Verify `channel_threads` table exists
- Verify `channel_messages` table exists
- Verify `artifact_deliveries` table exists
- Verify UNIQUE index on `(channel, external_id)` exists
- Verify indexes exist
