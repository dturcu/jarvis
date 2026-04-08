import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { runMigrations, CRM_MIGRATIONS, KNOWLEDGE_MIGRATIONS } from "@jarvis/runtime";

describe("Runtime DB and Migration Framework", () => {
  let dbPath: string;
  let db: DatabaseSync;

  beforeEach(() => {
    dbPath = join(os.tmpdir(), `jarvis-test-runtime-${Date.now()}.db`);
    db = new DatabaseSync(dbPath);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA foreign_keys = ON;");
  });

  afterEach(() => {
    try { db.close(); } catch { /* ok */ }
    try { fs.unlinkSync(dbPath); } catch { /* ok */ }
  });

  describe("runMigrations", () => {
    it("creates schema_migrations table", () => {
      runMigrations(db);
      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
      ).all();
      expect(tables).toHaveLength(1);
    });

    it("records applied migrations", () => {
      runMigrations(db);
      const rows = db.prepare("SELECT id, name FROM schema_migrations ORDER BY id").all() as Array<{ id: string; name: string }>;
      expect(rows).toHaveLength(7);
      expect(rows[0]!.id).toBe("0001");
      expect(rows[0]!.name).toBe("runtime_core");
      expect(rows[1]!.id).toBe("0002");
      expect(rows[1]!.name).toBe("production_fixes");
      expect(rows[2]!.id).toBe("0003");
      expect(rows[2]!.name).toBe("channel_persistence");
      expect(rows[3]!.id).toBe("0004");
      expect(rows[3]!.name).toBe("channel_fixes");
      expect(rows[4]!.id).toBe("0005");
      expect(rows[4]!.name).toBe("knowledge_links");
      expect(rows[5]!.id).toBe("0006");
      expect(rows[5]!.name).toBe("team_mode");
      expect(rows[6]!.id).toBe("0007");
      expect(rows[6]!.name).toBe("channel_full_content");
    });

    it("is idempotent — repeated runs do not fail", () => {
      runMigrations(db);
      runMigrations(db);
      const rows = db.prepare("SELECT id FROM schema_migrations").all();
      expect(rows).toHaveLength(7);
    });
  });

  describe("0001_runtime_core schema", () => {
    const EXPECTED_TABLES = [
      "approvals",
      "agent_commands",
      "run_events",
      "daemon_heartbeats",
      "notifications",
      "plugin_installs",
      "audit_log",
      "settings",
      "model_registry",
      "model_benchmarks",
      "schedules",
      "agent_memory",
      "runs",
      "channel_threads",
      "channel_messages",
      "artifact_deliveries",
      "decision_entity_links",
      "canonical_aliases",
    ];

    beforeEach(() => {
      runMigrations(db);
    });

    it("creates all 18 tables", () => {
      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name != 'schema_migrations' ORDER BY name",
      ).all() as Array<{ name: string }>;
      const tableNames = tables.map(t => t.name);
      for (const expected of EXPECTED_TABLES) {
        expect(tableNames, `Missing table: ${expected}`).toContain(expected);
      }
      expect(tables).toHaveLength(EXPECTED_TABLES.length);
    });

    it("creates indexes for common lookups", () => {
      const indexes = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name",
      ).all() as Array<{ name: string }>;
      const indexNames = indexes.map(i => i.name);

      expect(indexNames).toContain("idx_approvals_run_id");
      expect(indexNames).toContain("idx_approvals_status");
      expect(indexNames).toContain("idx_agent_commands_status_priority");
      expect(indexNames).toContain("idx_run_events_run_id");
      expect(indexNames).toContain("idx_audit_log_created_at");
      expect(indexNames).toContain("idx_notifications_status");
      expect(indexNames).toContain("idx_schedules_next_fire");
      expect(indexNames).toContain("idx_agent_memory_agent_type");
    });

    it("approvals table accepts and queries rows", () => {
      db.prepare(`
        INSERT INTO approvals (approval_id, run_id, agent_id, action, severity, requested_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run("a1", "r1", "bd-pipeline", "email.send", "critical", "2026-01-01T00:00:00Z");

      const row = db.prepare("SELECT * FROM approvals WHERE approval_id = ?").get("a1") as Record<string, unknown>;
      expect(row.status).toBe("pending");
      expect(row.agent_id).toBe("bd-pipeline");
    });

    it("agent_commands table enforces idempotency key uniqueness", () => {
      db.prepare(`
        INSERT INTO agent_commands (command_id, command_type, target_agent_id, status, created_at, idempotency_key)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run("c1", "run_agent", "garden-calendar", "queued", "2026-01-01T00:00:00Z", "idem-1");

      expect(() => {
        db.prepare(`
          INSERT INTO agent_commands (command_id, command_type, target_agent_id, status, created_at, idempotency_key)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run("c2", "run_agent", "garden-calendar", "queued", "2026-01-01T00:00:00Z", "idem-1");
      }).toThrow();
    });

    it("agent_commands null idempotency_key allows multiple rows", () => {
      db.prepare(`
        INSERT INTO agent_commands (command_id, command_type, target_agent_id, status, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run("c1", "run_agent", "garden-calendar", "queued", "2026-01-01T00:00:00Z");

      db.prepare(`
        INSERT INTO agent_commands (command_id, command_type, target_agent_id, status, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run("c2", "run_agent", "garden-calendar", "queued", "2026-01-01T00:00:01Z");

      const rows = db.prepare("SELECT * FROM agent_commands").all();
      expect(rows).toHaveLength(2);
    });

    it("run_events table stores and retrieves event history", () => {
      db.prepare(`
        INSERT INTO run_events (event_id, run_id, agent_id, event_type, step_no, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run("e1", "r1", "bd-pipeline", "run_started", 0, "2026-01-01T00:00:00Z");

      db.prepare(`
        INSERT INTO run_events (event_id, run_id, agent_id, event_type, step_no, action, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run("e2", "r1", "bd-pipeline", "step_completed", 1, "email.send", "2026-01-01T00:01:00Z");

      const events = db.prepare("SELECT * FROM run_events WHERE run_id = ? ORDER BY created_at").all("r1");
      expect(events).toHaveLength(2);
    });

    it("daemon_heartbeats supports UPSERT pattern", () => {
      db.prepare(`
        INSERT OR REPLACE INTO daemon_heartbeats (daemon_id, pid, status, last_seen_at)
        VALUES (?, ?, ?, ?)
      `).run("d1", 1234, "running", "2026-01-01T00:00:00Z");

      db.prepare(`
        INSERT OR REPLACE INTO daemon_heartbeats (daemon_id, pid, status, last_seen_at)
        VALUES (?, ?, ?, ?)
      `).run("d1", 1234, "running", "2026-01-01T00:00:10Z");

      const rows = db.prepare("SELECT * FROM daemon_heartbeats").all();
      expect(rows).toHaveLength(1);
      expect((rows[0] as Record<string, unknown>).last_seen_at).toBe("2026-01-01T00:00:10Z");
    });

    it("approvals enforces status CHECK constraint", () => {
      expect(() => {
        db.prepare(`
          INSERT INTO approvals (approval_id, action, severity, status, requested_at)
          VALUES (?, ?, ?, ?, ?)
        `).run("a1", "email.send", "critical", "invalid_status", "2026-01-01T00:00:00Z");
      }).toThrow();
    });

    it("agent_memory enforces memory_type CHECK constraint", () => {
      expect(() => {
        db.prepare(`
          INSERT INTO agent_memory (memory_id, agent_id, memory_type, key, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run("m1", "bd-pipeline", "invalid_type", "test", "2026-01-01T00:00:00Z");
      }).toThrow();
    });

    it("schedules table stores cron expressions and next fire times", () => {
      db.prepare(`
        INSERT INTO schedules (schedule_id, job_type, cron_expression, next_fire_at, enabled, scope_group, label, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run("s1", "agent.garden-calendar", "0 7 * * 1", "2026-01-06T07:00:00", 1, "agents", "Garden Calendar", "2026-01-01T00:00:00Z");

      const row = db.prepare("SELECT * FROM schedules WHERE schedule_id = ?").get("s1") as Record<string, unknown>;
      expect(row.cron_expression).toBe("0 7 * * 1");
      expect(row.enabled).toBe(1);
    });
  });

  // ─── CRM Migration Tests ──────────────────────────────────────────────────

  describe("CRM migrations (crm_0001_core)", () => {
    let crmDb: DatabaseSync;
    let crmDbPath: string;

    beforeEach(() => {
      crmDbPath = join(os.tmpdir(), `jarvis-test-crm-${Date.now()}.db`);
      crmDb = new DatabaseSync(crmDbPath);
      crmDb.exec("PRAGMA journal_mode = WAL;");
      crmDb.exec("PRAGMA foreign_keys = ON;");
      runMigrations(crmDb, CRM_MIGRATIONS);
    });

    afterEach(() => {
      try { crmDb.close(); } catch { /* ok */ }
      try { fs.unlinkSync(crmDbPath); } catch { /* ok */ }
    });

    it("creates all CRM tables", () => {
      const tables = crmDb.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name != 'schema_migrations' ORDER BY name",
      ).all() as Array<{ name: string }>;
      const names = tables.map(t => t.name);
      expect(names).toContain("contacts");
      expect(names).toContain("notes");
      expect(names).toContain("stage_history");
      expect(names).toContain("campaigns");
      expect(names).toContain("campaign_recipients");
    });

    it("records CRM migration", () => {
      const rows = crmDb.prepare("SELECT id, name FROM schema_migrations").all() as Array<{ id: string; name: string }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.id).toBe("0001");
      expect(rows[0]!.name).toBe("crm_core");
    });

    it("contacts table accepts and queries rows", () => {
      crmDb.prepare(`
        INSERT INTO contacts (id, name, company, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run("c1", "Test User", "Test Corp", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z");

      const row = crmDb.prepare("SELECT * FROM contacts WHERE id = ?").get("c1") as Record<string, unknown>;
      expect(row.stage).toBe("prospect");
      expect(row.score).toBe(0);
    });

    it("campaign_recipients has composite primary key", () => {
      crmDb.prepare(`INSERT INTO campaigns (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`).run("camp1", "Cold", "2026-01-01", "2026-01-01");
      crmDb.prepare(`INSERT INTO campaign_recipients (campaign_id, contact_id, email, enrolled_at, last_status_at) VALUES (?, ?, ?, ?, ?)`).run("camp1", "c1", "test@test.com", "2026-01-01", "2026-01-01");

      expect(() => {
        crmDb.prepare(`INSERT INTO campaign_recipients (campaign_id, contact_id, email, enrolled_at, last_status_at) VALUES (?, ?, ?, ?, ?)`).run("camp1", "c1", "test@test.com", "2026-01-01", "2026-01-01");
      }).toThrow();
    });

    it("is idempotent", () => {
      runMigrations(crmDb, CRM_MIGRATIONS);
      const rows = crmDb.prepare("SELECT COUNT(*) as n FROM schema_migrations").get() as { n: number };
      expect(rows.n).toBe(1);
    });
  });

  // ─── Knowledge Migration Tests ────────────────────────────────────────────

  describe("Knowledge migrations (knowledge_0001_core)", () => {
    let kbDb: DatabaseSync;
    let kbDbPath: string;

    beforeEach(() => {
      kbDbPath = join(os.tmpdir(), `jarvis-test-kb-${Date.now()}.db`);
      kbDb = new DatabaseSync(kbDbPath);
      kbDb.exec("PRAGMA journal_mode = WAL;");
      kbDb.exec("PRAGMA foreign_keys = ON;");
      runMigrations(kbDb, KNOWLEDGE_MIGRATIONS);
    });

    afterEach(() => {
      try { kbDb.close(); } catch { /* ok */ }
      try { fs.unlinkSync(kbDbPath); } catch { /* ok */ }
    });

    const EXPECTED_TABLES = [
      "documents", "playbooks", "entities", "relations", "decisions",
      "entity_provenance", "memory", "agent_runs", "embedding_chunks",
    ];

    it("creates all knowledge tables", () => {
      const tables = kbDb.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name != 'schema_migrations' ORDER BY name",
      ).all() as Array<{ name: string }>;
      const names = tables.map(t => t.name);
      for (const expected of EXPECTED_TABLES) {
        expect(names, `Missing table: ${expected}`).toContain(expected);
      }
    });

    it("records knowledge migration", () => {
      const rows = kbDb.prepare("SELECT id, name FROM schema_migrations").all() as Array<{ id: string; name: string }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.id).toBe("0001");
      expect(rows[0]!.name).toBe("knowledge_core");
    });

    it("creates indexes for knowledge tables", () => {
      const indexes = kbDb.prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name",
      ).all() as Array<{ name: string }>;
      const indexNames = indexes.map(i => i.name);
      expect(indexNames).toContain("idx_decisions_agent");
      expect(indexNames).toContain("idx_decisions_run");
      expect(indexNames).toContain("idx_prov_entity");
      expect(indexNames).toContain("idx_prov_agent");
      expect(indexNames).toContain("idx_memory_agent");
      expect(indexNames).toContain("idx_runs_agent");
      expect(indexNames).toContain("idx_chunks_doc");
    });

    it("entities enforces canonical_key uniqueness", () => {
      kbDb.prepare(`
        INSERT INTO entities (entity_id, entity_type, name, canonical_key, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run("e1", "company", "Volvo", "company:volvo", "2026-01-01", "2026-01-01");

      expect(() => {
        kbDb.prepare(`
          INSERT INTO entities (entity_id, entity_type, name, canonical_key, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run("e2", "company", "Volvo Duplicate", "company:volvo", "2026-01-01", "2026-01-01");
      }).toThrow();
    });

    it("memory enforces kind CHECK constraint", () => {
      expect(() => {
        kbDb.prepare(`
          INSERT INTO memory (entry_id, agent_id, run_id, kind, content, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run("m1", "bd-pipeline", "r1", "invalid_kind", "test", "2026-01-01");
      }).toThrow();
    });

    it("documents table stores and retrieves knowledge base entries", () => {
      kbDb.prepare(`
        INSERT INTO documents (doc_id, collection, title, content, tags, source_agent_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run("d1", "lessons", "Test lesson", "Content here", '["test"]', "bd-pipeline", "2026-01-01", "2026-01-01");

      const row = kbDb.prepare("SELECT * FROM documents WHERE doc_id = ?").get("d1") as Record<string, unknown>;
      expect(row.collection).toBe("lessons");
      expect(row.source_agent_id).toBe("bd-pipeline");
    });

    it("is idempotent", () => {
      runMigrations(kbDb, KNOWLEDGE_MIGRATIONS);
      const rows = kbDb.prepare("SELECT COUNT(*) as n FROM schema_migrations").get() as { n: number };
      expect(rows.n).toBe(1);
    });
  });
});
