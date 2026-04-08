/**
 * Credential Access Audit Tests
 *
 * Verifies that credential distribution is auditable (Epic 10).
 * Closes the trust gap: "getCredentialsForWorker() is not recorded in the audit log."
 */

import { describe, expect, it, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  logCredentialAccess,
  createAuditedCredentialAccessor,
  queryCredentialAccessLog,
  type CredentialAuditConfig,
  type CredentialAccessEvent,
} from "@jarvis/security/credential-audit";

function createTestDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE audit_log (
      audit_id TEXT PRIMARY KEY,
      actor_type TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      payload_json TEXT,
      created_at TEXT NOT NULL
    )
  `);
  return db;
}

describe("Credential Access Audit", () => {
  let db: DatabaseSync;
  let auditConfig: CredentialAuditConfig;

  beforeEach(() => {
    db = createTestDb();
    auditConfig = { db, enabled: true };
  });

  describe("logCredentialAccess", () => {
    it("records a credential access event in audit_log", () => {
      logCredentialAccess(auditConfig, {
        worker_id: "email",
        credential_keys: ["gmail"],
        run_id: "run-123",
        job_id: "job-456",
        granted: true,
        timestamp: "2026-04-08T12:00:00Z",
      });

      const rows = db.prepare("SELECT * FROM audit_log").all() as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.actor_type).toBe("worker");
      expect(rows[0]!.actor_id).toBe("email");
      expect(rows[0]!.action).toBe("credential.access");
      expect(rows[0]!.target_type).toBe("credential");
      expect(rows[0]!.target_id).toBe("gmail");
    });

    it("records denied access attempts", () => {
      logCredentialAccess(auditConfig, {
        worker_id: "inference",
        credential_keys: [],
        granted: false,
        reason: "No credentials configured for worker",
        timestamp: "2026-04-08T12:00:00Z",
      });

      const rows = db.prepare("SELECT * FROM audit_log").all() as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.action).toBe("credential.denied");
    });

    it("does nothing when audit is disabled", () => {
      const disabledConfig: CredentialAuditConfig = { db, enabled: false };
      logCredentialAccess(disabledConfig, {
        worker_id: "email",
        credential_keys: ["gmail"],
        granted: true,
        timestamp: "2026-04-08T12:00:00Z",
      });

      const rows = db.prepare("SELECT * FROM audit_log").all();
      expect(rows).toHaveLength(0);
    });
  });

  describe("createAuditedCredentialAccessor", () => {
    it("wraps an accessor and logs the distributed keys", () => {
      const mockAccessor = (workerId: string, _config: unknown) => {
        if (workerId === "email") return { gmail: { token: "t" } };
        return {};
      };

      const audited = createAuditedCredentialAccessor(auditConfig, mockAccessor);
      const result = audited("email", {}, { runId: "run-1", jobId: "job-1" });

      expect(result).toEqual({ gmail: { token: "t" } });

      const rows = db.prepare("SELECT * FROM audit_log").all() as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(1);

      const payload = JSON.parse(rows[0]!.payload_json as string) as Record<string, unknown>;
      expect(payload.keys).toEqual(["gmail"]);
      expect(payload.run_id).toBe("run-1");
      expect(payload.job_id).toBe("job-1");
    });

    it("logs empty key set for workers with no credentials", () => {
      const mockAccessor = () => ({});
      const audited = createAuditedCredentialAccessor(auditConfig, mockAccessor);
      audited("inference", {});

      const rows = db.prepare("SELECT * FROM audit_log").all() as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(1);

      const payload = JSON.parse(rows[0]!.payload_json as string) as Record<string, unknown>;
      expect(payload.keys).toEqual([]);
    });
  });

  describe("queryCredentialAccessLog", () => {
    beforeEach(() => {
      // Seed some audit entries
      for (const entry of [
        { worker: "email", keys: ["gmail"], time: "2026-04-08T10:00:00Z" },
        { worker: "browser", keys: ["chrome"], time: "2026-04-08T11:00:00Z" },
        { worker: "email", keys: ["gmail"], time: "2026-04-08T12:00:00Z" },
      ]) {
        logCredentialAccess(auditConfig, {
          worker_id: entry.worker,
          credential_keys: entry.keys,
          granted: true,
          timestamp: entry.time,
        });
      }
    });

    it("returns all entries by default", () => {
      const entries = queryCredentialAccessLog(db);
      expect(entries).toHaveLength(3);
    });

    it("filters by worker_id", () => {
      const entries = queryCredentialAccessLog(db, { workerId: "email" });
      expect(entries).toHaveLength(2);
      expect(entries.every((e) => e.worker_id === "email")).toBe(true);
    });

    it("filters by since timestamp", () => {
      const entries = queryCredentialAccessLog(db, {
        since: "2026-04-08T11:00:00Z",
      });
      expect(entries).toHaveLength(2);
    });

    it("respects limit", () => {
      const entries = queryCredentialAccessLog(db, { limit: 1 });
      expect(entries).toHaveLength(1);
    });
  });
});
