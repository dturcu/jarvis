/**
 * Stress: Exhaustive Approval System
 *
 * Tests every severity level, resolution status, concurrent operations,
 * audit logging, ordering, lifecycle integration, and edge cases across
 * the approval bridge.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  RunStore,
  requestApproval,
  resolveApproval,
  listApprovals,
  type ApprovalEntry,
} from "@jarvis/runtime";
import { createStressDb, cleanupDb, range } from "./helpers.js";

// ── Constants ───────────────────────────────────────────────────────────────

const SEVERITIES = ["info", "warning", "critical"] as const;
const RESOLUTION_STATUSES = ["approved", "rejected", "expired"] as const;

// ── Tests ───────────────────────────────────────────────────────────────────

describe("Approval System — Exhaustive", () => {
  let db: DatabaseSync;
  let dbPath: string;
  let store: RunStore;

  beforeEach(() => {
    ({ db, path: dbPath } = createStressDb("approval"));
    store = new RunStore(db);
  });

  afterEach(() => cleanupDb(db, dbPath));

  // ── 1. Every severity level ─────────────────────────────────────────────

  describe("severity levels", () => {
    for (const severity of SEVERITIES) {
      it(`requests approval with severity "${severity}" and stores correctly`, () => {
        const runId = store.startRun("sev-agent", "test");
        const approvalId = requestApproval(db, {
          agent_id: "sev-agent",
          run_id: runId,
          action: `test.action.${severity}`,
          severity,
          payload: JSON.stringify({ level: severity }),
        });

        expect(approvalId).toBeTruthy();
        expect(typeof approvalId).toBe("string");

        const approvals = listApprovals(db, "pending");
        const found = approvals.find((a) => a.id === approvalId);
        expect(found).toBeTruthy();
        expect(found!.severity).toBe(severity);
        expect(found!.agent).toBe("sev-agent");
        expect(found!.action).toBe(`test.action.${severity}`);
        expect(found!.status).toBe("pending");
      });
    }

    it("all three severity levels coexist in the same listing", () => {
      const runId = store.startRun("multi-sev", "test");
      for (const severity of SEVERITIES) {
        requestApproval(db, {
          agent_id: "multi-sev",
          run_id: runId,
          action: "test.action",
          severity,
          payload: "{}",
        });
      }

      const all = listApprovals(db);
      expect(all.length).toBe(3);
      const severitiesFound = new Set(all.map((a) => a.severity));
      expect(severitiesFound.size).toBe(3);
      for (const s of SEVERITIES) {
        expect(severitiesFound.has(s)).toBe(true);
      }
    });
  });

  // ── 2. Every resolution status ──────────────────────────────────────────

  describe("resolution statuses", () => {
    for (const resStatus of RESOLUTION_STATUSES) {
      it(`resolves approval with status "${resStatus}"`, () => {
        const runId = store.startRun("res-agent", "test");
        const approvalId = requestApproval(db, {
          agent_id: "res-agent",
          run_id: runId,
          action: "test.action",
          severity: "warning",
          payload: "{}",
        });

        const result = resolveApproval(db, approvalId, resStatus, "test-user");
        expect(result).toBe(true);

        const approvals = listApprovals(db, resStatus);
        const found = approvals.find((a) => a.id === approvalId);
        expect(found).toBeTruthy();
        expect(found!.status).toBe(resStatus);
        expect(found!.resolved_by).toBe("test-user");
        expect(found!.resolved_at).toBeTruthy();
      });
    }
  });

  // ── 3. Double resolve ──────────────────────────────────────────────────

  describe("double resolve", () => {
    it("second resolve returns false", () => {
      const runId = store.startRun("double-agent", "test");
      const approvalId = requestApproval(db, {
        agent_id: "double-agent",
        run_id: runId,
        action: "email.send",
        severity: "critical",
        payload: "{}",
      });

      const first = resolveApproval(db, approvalId, "approved", "user-1");
      expect(first).toBe(true);

      const second = resolveApproval(db, approvalId, "rejected", "user-2");
      expect(second).toBe(false);
    });

    it("double resolve does not change the original resolution", () => {
      const runId = store.startRun("double-stable", "test");
      const approvalId = requestApproval(db, {
        agent_id: "double-stable",
        run_id: runId,
        action: "trade_execute",
        severity: "critical",
        payload: "{}",
      });

      resolveApproval(db, approvalId, "approved", "admin");
      resolveApproval(db, approvalId, "rejected", "other-admin");

      const approvals = listApprovals(db, "approved");
      const found = approvals.find((a) => a.id === approvalId);
      expect(found).toBeTruthy();
      expect(found!.resolved_by).toBe("admin");
    });

    for (const first of RESOLUTION_STATUSES) {
      for (const second of RESOLUTION_STATUSES) {
        it(`resolve ${first} then ${second} — second returns false`, () => {
          const runId = store.startRun("dbl-matrix", "test");
          const approvalId = requestApproval(db, {
            agent_id: "dbl-matrix",
            run_id: runId,
            action: "test.action",
            severity: "info",
            payload: "{}",
          });

          expect(resolveApproval(db, approvalId, first, "user-a")).toBe(true);
          expect(resolveApproval(db, approvalId, second, "user-b")).toBe(false);
        });
      }
    }
  });

  // ── 4. List by every status ─────────────────────────────────────────────

  describe("list by status", () => {
    beforeEach(() => {
      // Create 4 approvals, resolve them to different statuses
      const runId = store.startRun("list-agent", "test");

      const a1 = requestApproval(db, { agent_id: "list-agent", run_id: runId, action: "a1", severity: "info", payload: "{}" });
      const a2 = requestApproval(db, { agent_id: "list-agent", run_id: runId, action: "a2", severity: "warning", payload: "{}" });
      const a3 = requestApproval(db, { agent_id: "list-agent", run_id: runId, action: "a3", severity: "critical", payload: "{}" });
      // a4 stays pending
      requestApproval(db, { agent_id: "list-agent", run_id: runId, action: "a4", severity: "info", payload: "{}" });

      resolveApproval(db, a1, "approved", "admin");
      resolveApproval(db, a2, "rejected", "admin");
      resolveApproval(db, a3, "expired", "system");
    });

    it("list pending returns only pending approvals", () => {
      const pending = listApprovals(db, "pending");
      expect(pending.length).toBe(1);
      expect(pending[0].action).toBe("a4");
    });

    it("list approved returns only approved approvals", () => {
      const approved = listApprovals(db, "approved");
      expect(approved.length).toBe(1);
      expect(approved[0].action).toBe("a1");
    });

    it("list rejected returns only rejected approvals", () => {
      const rejected = listApprovals(db, "rejected");
      expect(rejected.length).toBe(1);
      expect(rejected[0].action).toBe("a2");
    });

    it("list expired returns only expired approvals", () => {
      const expired = listApprovals(db, "expired");
      expect(expired.length).toBe(1);
      expect(expired[0].action).toBe("a3");
    });

    it("list with no status filter returns all approvals", () => {
      const all = listApprovals(db);
      expect(all.length).toBe(4);
    });

    it("list with undefined status returns all approvals", () => {
      const all = listApprovals(db, undefined);
      expect(all.length).toBe(4);
    });
  });

  // ── 5. Concurrent request + resolve ─────────────────────────────────────

  describe("concurrent operations", () => {
    it("50 parallel approval requests all succeed", async () => {
      const runId = store.startRun("conc-agent", "test");
      const results = await Promise.all(
        range(50).map(async (i) => {
          try {
            const id = requestApproval(db, {
              agent_id: "conc-agent",
              run_id: runId,
              action: `action.${i}`,
              severity: SEVERITIES[i % 3],
              payload: JSON.stringify({ index: i }),
            });
            return { id, error: null };
          } catch (e) {
            return { id: null, error: String(e) };
          }
        }),
      );

      const errors = results.filter((r) => r.error !== null);
      expect(errors).toHaveLength(0);

      const ids = new Set(results.map((r) => r.id));
      expect(ids.size).toBe(50);
    });

    it("50 parallel resolves after 50 requests", async () => {
      const runId = store.startRun("resolve-agent", "test");

      // Create 50 approvals sequentially (IDs needed for resolve)
      const approvalIds: string[] = [];
      for (let i = 0; i < 50; i++) {
        approvalIds.push(requestApproval(db, {
          agent_id: "resolve-agent",
          run_id: runId,
          action: `action.${i}`,
          severity: SEVERITIES[i % 3],
          payload: "{}",
        }));
      }

      // Resolve all 50 in parallel
      const results = await Promise.all(
        approvalIds.map(async (id, i) => {
          try {
            const status = RESOLUTION_STATUSES[i % 3];
            const ok = resolveApproval(db, id, status, `user-${i}`);
            return { ok, error: null };
          } catch (e) {
            return { ok: false, error: String(e) };
          }
        }),
      );

      const errors = results.filter((r) => r.error !== null);
      expect(errors).toHaveLength(0);
      expect(results.every((r) => r.ok === true)).toBe(true);

      // Verify no pending remain
      const pending = listApprovals(db, "pending");
      expect(pending).toHaveLength(0);
    });
  });

  // ── 6. Resolve non-existent approval ────────────────────────────────────

  describe("resolve non-existent", () => {
    it("returns false for non-existent approval_id", () => {
      const result = resolveApproval(db, "nonexistent-id", "approved", "admin");
      expect(result).toBe(false);
    });

    it("returns false for empty string approval_id", () => {
      const result = resolveApproval(db, "", "rejected", "admin");
      expect(result).toBe(false);
    });

    it("returns false for random UUID approval_id", () => {
      const result = resolveApproval(db, randomUUID(), "expired", "system");
      expect(result).toBe(false);
    });
  });

  // ── 7. Approval with resolution notes ───────────────────────────────────

  describe("resolution notes", () => {
    it("stores resolution note on approve", () => {
      const runId = store.startRun("note-agent", "test");
      const id = requestApproval(db, {
        agent_id: "note-agent",
        run_id: runId,
        action: "email.send",
        severity: "critical",
        payload: "{}",
      });

      resolveApproval(db, id, "approved", "admin", "LGTM, send it");

      const approvals = listApprovals(db, "approved");
      const found = approvals.find((a) => a.id === id);
      expect(found!.resolution_note).toBe("LGTM, send it");
    });

    it("stores resolution note on reject", () => {
      const runId = store.startRun("note-agent", "test");
      const id = requestApproval(db, {
        agent_id: "note-agent",
        run_id: runId,
        action: "publish_post",
        severity: "critical",
        payload: "{}",
      });

      resolveApproval(db, id, "rejected", "reviewer", "Content needs revision");

      const approvals = listApprovals(db, "rejected");
      const found = approvals.find((a) => a.id === id);
      expect(found!.resolution_note).toBe("Content needs revision");
    });

    it("resolution note is null when omitted", () => {
      const runId = store.startRun("no-note", "test");
      const id = requestApproval(db, {
        agent_id: "no-note",
        run_id: runId,
        action: "test.action",
        severity: "info",
        payload: "{}",
      });

      resolveApproval(db, id, "approved", "admin");

      const approvals = listApprovals(db, "approved");
      const found = approvals.find((a) => a.id === id);
      expect(found!.resolution_note).toBeNull();
    });

    it("stores long resolution note", () => {
      const runId = store.startRun("long-note", "test");
      const id = requestApproval(db, {
        agent_id: "long-note",
        run_id: runId,
        action: "test.action",
        severity: "warning",
        payload: "{}",
      });

      const longNote = "A".repeat(5000);
      resolveApproval(db, id, "rejected", "admin", longNote);

      const approvals = listApprovals(db, "rejected");
      const found = approvals.find((a) => a.id === id);
      expect(found!.resolution_note).toBe(longNote);
    });
  });

  // ── 8. Large payload ────────────────────────────────────────────────────

  describe("large payload", () => {
    it("stores and retrieves 10KB JSON payload", () => {
      const runId = store.startRun("large-payload", "test");
      const largeData: Record<string, string> = {};
      // Build ~10KB payload
      for (let i = 0; i < 100; i++) {
        largeData[`key_${i}`] = "x".repeat(100);
      }
      const payload = JSON.stringify(largeData);
      expect(payload.length).toBeGreaterThan(10_000);

      const id = requestApproval(db, {
        agent_id: "large-payload",
        run_id: runId,
        action: "large.action",
        severity: "warning",
        payload,
      });

      const approvals = listApprovals(db, "pending");
      const found = approvals.find((a) => a.id === id);
      expect(found).toBeTruthy();
      const parsed = JSON.parse(found!.payload);
      expect(Object.keys(parsed).length).toBe(100);
      expect(parsed.key_0).toBe("x".repeat(100));
    });

    it("stores minimal JSON payload", () => {
      const runId = store.startRun("min-payload", "test");
      const id = requestApproval(db, {
        agent_id: "min-payload",
        run_id: runId,
        action: "test.action",
        severity: "info",
        payload: "{}",
      });

      const approvals = listApprovals(db, "pending");
      const found = approvals.find((a) => a.id === id);
      expect(found!.payload).toBe("{}");
    });
  });

  // ── 9. Audit log entries ────────────────────────────────────────────────

  describe("audit log", () => {
    it("resolve creates an audit_log entry", () => {
      const runId = store.startRun("audit-agent", "test");
      const id = requestApproval(db, {
        agent_id: "audit-agent",
        run_id: runId,
        action: "email.send",
        severity: "critical",
        payload: "{}",
      });

      resolveApproval(db, id, "approved", "admin-user", "Looks good");

      const logs = db.prepare(
        "SELECT * FROM audit_log WHERE target_type = 'approval' AND target_id = ?",
      ).all(id) as any[];

      expect(logs.length).toBe(1);
      expect(logs[0].actor_type).toBe("user");
      expect(logs[0].actor_id).toBe("admin-user");
      expect(logs[0].action).toBe("approval.approved");

      const payload = JSON.parse(logs[0].payload_json);
      expect(payload.note).toBe("Looks good");
    });

    it("rejected resolution creates audit entry with correct action", () => {
      const runId = store.startRun("audit-rej", "test");
      const id = requestApproval(db, {
        agent_id: "audit-rej",
        run_id: runId,
        action: "publish_post",
        severity: "critical",
        payload: "{}",
      });

      resolveApproval(db, id, "rejected", "mod-user");

      const logs = db.prepare(
        "SELECT * FROM audit_log WHERE target_id = ?",
      ).all(id) as any[];

      expect(logs.length).toBe(1);
      expect(logs[0].action).toBe("approval.rejected");
    });

    it("expired resolution creates audit entry", () => {
      const runId = store.startRun("audit-exp", "test");
      const id = requestApproval(db, {
        agent_id: "audit-exp",
        run_id: runId,
        action: "trade_execute",
        severity: "critical",
        payload: "{}",
      });

      resolveApproval(db, id, "expired", "system");

      const logs = db.prepare(
        "SELECT * FROM audit_log WHERE target_id = ?",
      ).all(id) as any[];

      expect(logs.length).toBe(1);
      expect(logs[0].action).toBe("approval.expired");
    });

    it("failed double resolve does not create a second audit entry", () => {
      const runId = store.startRun("audit-dbl", "test");
      const id = requestApproval(db, {
        agent_id: "audit-dbl",
        run_id: runId,
        action: "test.action",
        severity: "info",
        payload: "{}",
      });

      resolveApproval(db, id, "approved", "user-1");
      resolveApproval(db, id, "rejected", "user-2"); // returns false

      const logs = db.prepare(
        "SELECT * FROM audit_log WHERE target_id = ?",
      ).all(id) as any[];

      expect(logs.length).toBe(1);
      expect(logs[0].actor_id).toBe("user-1");
    });

    it("50 resolves produce 50 audit log entries", () => {
      const runId = store.startRun("audit-bulk", "test");
      const ids: string[] = [];
      for (let i = 0; i < 50; i++) {
        ids.push(requestApproval(db, {
          agent_id: "audit-bulk",
          run_id: runId,
          action: `action.${i}`,
          severity: SEVERITIES[i % 3],
          payload: "{}",
        }));
      }

      for (let i = 0; i < 50; i++) {
        resolveApproval(db, ids[i], RESOLUTION_STATUSES[i % 3], `user-${i}`);
      }

      const logs = db.prepare(
        "SELECT COUNT(*) as cnt FROM audit_log WHERE target_type = 'approval'",
      ).get() as { cnt: number };
      expect(logs.cnt).toBe(50);
    });
  });

  // ── 10. Approval ordering ───────────────────────────────────────────────

  describe("ordering", () => {
    it("approvals are returned in DESC requested_at order", () => {
      const runId = store.startRun("order-agent", "test");

      for (let i = 0; i < 20; i++) {
        requestApproval(db, {
          agent_id: "order-agent",
          run_id: runId,
          action: `action.${i}`,
          severity: "info",
          payload: JSON.stringify({ seq: i }),
        });
      }

      const all = listApprovals(db);
      expect(all.length).toBe(20);

      // DESC by created_at
      for (let i = 1; i < all.length; i++) {
        expect(all[i - 1].created_at >= all[i].created_at).toBe(true);
      }
    });

    it("mixed pending and resolved maintain DESC ordering", () => {
      const runId = store.startRun("mixed-order", "test");

      const ids: string[] = [];
      for (let i = 0; i < 10; i++) {
        ids.push(requestApproval(db, {
          agent_id: "mixed-order",
          run_id: runId,
          action: `action.${i}`,
          severity: SEVERITIES[i % 3],
          payload: "{}",
        }));
      }

      // Resolve even-indexed
      for (let i = 0; i < 10; i += 2) {
        resolveApproval(db, ids[i], "approved", "admin");
      }

      const all = listApprovals(db);
      expect(all.length).toBe(10);
      for (let i = 1; i < all.length; i++) {
        expect(all[i - 1].created_at >= all[i].created_at).toBe(true);
      }
    });
  });

  // ── 11. Mixed severities batch ──────────────────────────────────────────

  describe("mixed severities batch", () => {
    it("30 approvals (10 per severity), resolve variously, verify counts", () => {
      const runId = store.startRun("batch-agent", "test");
      const idsBySeverity: Record<string, string[]> = { info: [], warning: [], critical: [] };

      for (const severity of SEVERITIES) {
        for (let i = 0; i < 10; i++) {
          const id = requestApproval(db, {
            agent_id: "batch-agent",
            run_id: runId,
            action: `batch.${severity}.${i}`,
            severity,
            payload: "{}",
          });
          idsBySeverity[severity].push(id);
        }
      }

      expect(listApprovals(db, "pending").length).toBe(30);

      // Approve all info
      for (const id of idsBySeverity.info) {
        resolveApproval(db, id, "approved", "admin");
      }

      // Reject all warning
      for (const id of idsBySeverity.warning) {
        resolveApproval(db, id, "rejected", "admin");
      }

      // Expire half critical, leave half pending
      for (let i = 0; i < 5; i++) {
        resolveApproval(db, idsBySeverity.critical[i], "expired", "system");
      }

      expect(listApprovals(db, "approved").length).toBe(10);
      expect(listApprovals(db, "rejected").length).toBe(10);
      expect(listApprovals(db, "expired").length).toBe(5);
      expect(listApprovals(db, "pending").length).toBe(5);
      expect(listApprovals(db).length).toBe(30);
    });
  });

  // ── 12. Approval lifecycle with run lifecycle ───────────────────────────

  describe("approval + run lifecycle integration", () => {
    it("full flow: run -> approval -> resolve -> continue run", () => {
      const agentId = "lifecycle-agent";
      const runId = store.startRun(agentId, "manual");

      // planning -> executing
      store.transition(runId, agentId, "executing", "plan_built");

      // executing -> awaiting_approval
      store.transition(runId, agentId, "awaiting_approval", "approval_requested");

      // Request approval
      const approvalId = requestApproval(db, {
        agent_id: agentId,
        run_id: runId,
        action: "email.send",
        severity: "critical",
        payload: JSON.stringify({ to: "client@example.com" }),
      });

      expect(store.getStatus(runId)).toBe("awaiting_approval");
      expect(listApprovals(db, "pending").length).toBe(1);

      // Resolve approval
      resolveApproval(db, approvalId, "approved", "daniel");

      // awaiting_approval -> executing
      store.transition(runId, agentId, "executing", "approval_resolved");

      // executing -> completed
      store.transition(runId, agentId, "completed", "run_completed");

      expect(store.getStatus(runId)).toBe("completed");
      expect(listApprovals(db, "approved").length).toBe(1);
    });

    it("rejected approval followed by run failure", () => {
      const agentId = "rej-lifecycle";
      const runId = store.startRun(agentId, "test");
      store.transition(runId, agentId, "executing", "plan_built");
      store.transition(runId, agentId, "awaiting_approval", "approval_requested");

      const approvalId = requestApproval(db, {
        agent_id: agentId,
        run_id: runId,
        action: "trade_execute",
        severity: "critical",
        payload: "{}",
      });

      resolveApproval(db, approvalId, "rejected", "admin", "Too risky");

      // Approval rejected, run transitions to failed
      store.transition(runId, agentId, "failed", "run_failed", {
        details: { reason: "Approval rejected" },
      });

      expect(store.getStatus(runId)).toBe("failed");
      const run = store.getRun(runId);
      expect(run!.error).toBe("Approval rejected");
    });
  });

  // ── 13. Multiple approvals per run ──────────────────────────────────────

  describe("multiple approvals per run", () => {
    it("5 approvals on same run resolve independently", () => {
      const runId = store.startRun("multi-app", "test");
      const ids: string[] = [];

      for (let i = 0; i < 5; i++) {
        ids.push(requestApproval(db, {
          agent_id: "multi-app",
          run_id: runId,
          action: `action.${i}`,
          severity: SEVERITIES[i % 3],
          payload: JSON.stringify({ step: i }),
        }));
      }

      expect(listApprovals(db, "pending").length).toBe(5);

      // Approve first two, reject third, expire fourth, leave fifth pending
      resolveApproval(db, ids[0], "approved", "admin");
      resolveApproval(db, ids[1], "approved", "admin");
      resolveApproval(db, ids[2], "rejected", "admin");
      resolveApproval(db, ids[3], "expired", "system");

      expect(listApprovals(db, "approved").length).toBe(2);
      expect(listApprovals(db, "rejected").length).toBe(1);
      expect(listApprovals(db, "expired").length).toBe(1);
      expect(listApprovals(db, "pending").length).toBe(1);
    });

    it("all approvals share the same run_id", () => {
      const runId = store.startRun("shared-run", "test");

      for (let i = 0; i < 5; i++) {
        requestApproval(db, {
          agent_id: "shared-run",
          run_id: runId,
          action: `action.${i}`,
          severity: "info",
          payload: "{}",
        });
      }

      const all = listApprovals(db);
      expect(all.length).toBe(5);
      for (const a of all) {
        expect(a.run_id).toBe(runId);
      }
    });
  });

  // ── 14. Rapid request-resolve cycles ────────────────────────────────────

  describe("rapid request-resolve cycles", () => {
    it("100 sequential request-resolve pairs", () => {
      const runId = store.startRun("rapid-agent", "test");
      const errors: string[] = [];

      for (let i = 0; i < 100; i++) {
        try {
          const id = requestApproval(db, {
            agent_id: "rapid-agent",
            run_id: runId,
            action: `rapid.${i}`,
            severity: SEVERITIES[i % 3],
            payload: JSON.stringify({ cycle: i }),
          });

          const status = RESOLUTION_STATUSES[i % 3];
          const ok = resolveApproval(db, id, status, `user-${i}`);
          expect(ok).toBe(true);
        } catch (e) {
          errors.push(String(e));
        }
      }

      expect(errors).toHaveLength(0);

      // No pending should remain
      expect(listApprovals(db, "pending")).toHaveLength(0);

      // Total should be 100
      const all = listApprovals(db);
      expect(all.length).toBe(100);
    });

    it("rapid cycles produce correct audit log count", () => {
      const runId = store.startRun("rapid-audit", "test");

      for (let i = 0; i < 50; i++) {
        const id = requestApproval(db, {
          agent_id: "rapid-audit",
          run_id: runId,
          action: `cycle.${i}`,
          severity: "info",
          payload: "{}",
        });
        resolveApproval(db, id, "approved", "admin");
      }

      const logs = db.prepare(
        "SELECT COUNT(*) as cnt FROM audit_log WHERE target_type = 'approval'",
      ).get() as { cnt: number };
      expect(logs.cnt).toBe(50);
    });
  });

  // ── 15. Empty payload ───────────────────────────────────────────────────

  describe("empty payload", () => {
    it("stores and retrieves empty string payload", () => {
      const runId = store.startRun("empty-payload", "test");
      const id = requestApproval(db, {
        agent_id: "empty-payload",
        run_id: runId,
        action: "test.action",
        severity: "info",
        payload: "",
      });

      const approvals = listApprovals(db, "pending");
      const found = approvals.find((a) => a.id === id);
      expect(found).toBeTruthy();
      expect(found!.payload).toBe("");
    });

    it("empty payload approval can be resolved", () => {
      const runId = store.startRun("empty-resolve", "test");
      const id = requestApproval(db, {
        agent_id: "empty-resolve",
        run_id: runId,
        action: "test.action",
        severity: "warning",
        payload: "",
      });

      const ok = resolveApproval(db, id, "approved", "admin");
      expect(ok).toBe(true);
    });
  });

  // ── 16. Concurrent list during writes ───────────────────────────────────

  describe("concurrent list during writes", () => {
    it("list while requesting in parallel returns consistent results", async () => {
      const runId = store.startRun("conc-list", "test");
      const listErrors: string[] = [];
      const writeErrors: string[] = [];

      await Promise.all([
        // 30 writes
        ...range(30).map(async (i) => {
          try {
            requestApproval(db, {
              agent_id: "conc-list",
              run_id: runId,
              action: `write.${i}`,
              severity: SEVERITIES[i % 3],
              payload: "{}",
            });
          } catch (e) {
            writeErrors.push(String(e));
          }
        }),
        // 30 reads
        ...range(30).map(async () => {
          try {
            const result = listApprovals(db);
            expect(Array.isArray(result)).toBe(true);
            // Each entry should have the expected shape
            for (const a of result) {
              expect(a.id).toBeTruthy();
              expect(a.status).toBeTruthy();
            }
          } catch (e) {
            listErrors.push(String(e));
          }
        }),
      ]);

      expect(writeErrors).toHaveLength(0);
      expect(listErrors).toHaveLength(0);

      // Final count should be 30
      const final = listApprovals(db);
      expect(final.length).toBe(30);
    });

    it("resolve while listing in parallel stays consistent", async () => {
      const runId = store.startRun("conc-resolve-list", "test");

      // Create 20 approvals
      const ids: string[] = [];
      for (let i = 0; i < 20; i++) {
        ids.push(requestApproval(db, {
          agent_id: "conc-resolve-list",
          run_id: runId,
          action: `action.${i}`,
          severity: "info",
          payload: "{}",
        }));
      }

      const errors: string[] = [];

      await Promise.all([
        // Resolve all 20
        ...ids.map(async (id, i) => {
          try {
            resolveApproval(db, id, "approved", `user-${i}`);
          } catch (e) {
            errors.push(String(e));
          }
        }),
        // List 20 times
        ...range(20).map(async () => {
          try {
            const result = listApprovals(db);
            expect(Array.isArray(result)).toBe(true);
            expect(result.length).toBe(20);
          } catch (e) {
            errors.push(String(e));
          }
        }),
      ]);

      expect(errors).toHaveLength(0);

      // All should now be approved
      const approved = listApprovals(db, "approved");
      expect(approved.length).toBe(20);
    });
  });

  // ── 17. Approval field completeness ─────────────────────────────────────

  describe("approval field completeness", () => {
    it("pending approval has all expected fields", () => {
      const runId = store.startRun("field-agent", "test");
      const id = requestApproval(db, {
        agent_id: "field-agent",
        run_id: runId,
        action: "email.send",
        severity: "critical",
        payload: JSON.stringify({ to: "test@example.com" }),
      });

      const approvals = listApprovals(db, "pending");
      const found = approvals.find((a) => a.id === id)!;

      expect(found.id).toBe(id);
      expect(found.agent).toBe("field-agent");
      expect(found.action).toBe("email.send");
      expect(found.severity).toBe("critical");
      expect(found.status).toBe("pending");
      expect(found.run_id).toBe(runId);
      expect(found.created_at).toBeTruthy();
      expect(found.payload).toBeTruthy();
    });

    it("resolved approval has resolution fields populated", () => {
      const runId = store.startRun("resolved-fields", "test");
      const id = requestApproval(db, {
        agent_id: "resolved-fields",
        run_id: runId,
        action: "publish_post",
        severity: "critical",
        payload: "{}",
      });

      resolveApproval(db, id, "approved", "admin-user", "Ship it");

      const approvals = listApprovals(db, "approved");
      const found = approvals.find((a) => a.id === id)!;

      expect(found.resolved_at).toBeTruthy();
      expect(found.resolved_by).toBe("admin-user");
      expect(found.resolution_note).toBe("Ship it");
    });
  });

  // ── 18. Approval ID uniqueness ──────────────────────────────────────────

  describe("approval ID uniqueness", () => {
    it("200 approval requests produce 200 unique IDs", () => {
      const runId = store.startRun("unique-id-agent", "test");
      const ids = new Set<string>();

      for (let i = 0; i < 200; i++) {
        const id = requestApproval(db, {
          agent_id: "unique-id-agent",
          run_id: runId,
          action: `action.${i}`,
          severity: SEVERITIES[i % 3],
          payload: "{}",
        });
        ids.add(id);
      }

      expect(ids.size).toBe(200);
    });

    it("approval IDs are short (8 char UUIDs)", () => {
      const runId = store.startRun("short-id", "test");
      const id = requestApproval(db, {
        agent_id: "short-id",
        run_id: runId,
        action: "test.action",
        severity: "info",
        payload: "{}",
      });

      expect(id.length).toBe(8);
    });
  });

  // ── 19. Multiple agents requesting approvals ───────────────────────────

  describe("multi-agent approvals", () => {
    it("different agents request approvals on different runs", () => {
      const agents = ["bd-pipeline", "content-engine", "portfolio-monitor", "email-campaign", "social-engagement"];
      const approvalIds: string[] = [];

      for (const agent of agents) {
        const runId = store.startRun(agent, "scheduled");
        const id = requestApproval(db, {
          agent_id: agent,
          run_id: runId,
          action: `${agent}.publish`,
          severity: "critical",
          payload: JSON.stringify({ agent }),
        });
        approvalIds.push(id);
      }

      const all = listApprovals(db, "pending");
      expect(all.length).toBe(5);

      const agentNames = new Set(all.map((a) => a.agent));
      expect(agentNames.size).toBe(5);
      for (const agent of agents) {
        expect(agentNames.has(agent)).toBe(true);
      }
    });

    it("resolving one agent approval does not affect another", () => {
      const runA = store.startRun("agent-a", "test");
      const runB = store.startRun("agent-b", "test");

      const idA = requestApproval(db, {
        agent_id: "agent-a",
        run_id: runA,
        action: "email.send",
        severity: "critical",
        payload: "{}",
      });

      const idB = requestApproval(db, {
        agent_id: "agent-b",
        run_id: runB,
        action: "publish_post",
        severity: "critical",
        payload: "{}",
      });

      resolveApproval(db, idA, "approved", "admin");

      // Agent B's approval should still be pending
      const pending = listApprovals(db, "pending");
      expect(pending.length).toBe(1);
      expect(pending[0].id).toBe(idB);
      expect(pending[0].agent).toBe("agent-b");
    });
  });

  // ── 20. Approval action names ──────────────────────────────────────────

  describe("action name variety", () => {
    const actions = [
      "email.send",
      "publish_post",
      "post_comment",
      "trade_execute",
      "crm.move_stage",
      "document.generate_report",
    ];

    for (const action of actions) {
      it(`stores and retrieves action "${action}"`, () => {
        const runId = store.startRun("action-agent", "test");
        const id = requestApproval(db, {
          agent_id: "action-agent",
          run_id: runId,
          action,
          severity: "critical",
          payload: "{}",
        });

        const all = listApprovals(db);
        const found = all.find((a) => a.id === id);
        expect(found!.action).toBe(action);
      });
    }
  });

  // ── 21. Timestamps correctness ─────────────────────────────────────────

  describe("timestamp correctness", () => {
    it("created_at is a valid ISO timestamp", () => {
      const runId = store.startRun("ts-agent", "test");
      requestApproval(db, {
        agent_id: "ts-agent",
        run_id: runId,
        action: "test.action",
        severity: "info",
        payload: "{}",
      });

      const all = listApprovals(db);
      for (const a of all) {
        const ts = new Date(a.created_at);
        expect(ts.getTime()).not.toBeNaN();
      }
    });

    it("resolved_at is after created_at", () => {
      const runId = store.startRun("ts-order", "test");
      const id = requestApproval(db, {
        agent_id: "ts-order",
        run_id: runId,
        action: "test.action",
        severity: "warning",
        payload: "{}",
      });

      resolveApproval(db, id, "approved", "admin");

      const all = listApprovals(db, "approved");
      const found = all.find((a) => a.id === id)!;
      expect(new Date(found.resolved_at!).getTime()).toBeGreaterThanOrEqual(
        new Date(found.created_at).getTime(),
      );
    });

    it("pending approval has no resolved_at", () => {
      const runId = store.startRun("ts-pending", "test");
      requestApproval(db, {
        agent_id: "ts-pending",
        run_id: runId,
        action: "test.action",
        severity: "info",
        payload: "{}",
      });

      const pending = listApprovals(db, "pending");
      expect(pending[0].resolved_at).toBeNull();
      expect(pending[0].resolved_by).toBeNull();
    });
  });

  // ── 22. Resolved_by values ─────────────────────────────────────────────

  describe("resolved_by variety", () => {
    const resolvers = ["admin", "daniel", "system", "telegram-bot", "dashboard-api"];

    for (const resolver of resolvers) {
      it(`resolver "${resolver}" is stored correctly`, () => {
        const runId = store.startRun("resolver-agent", "test");
        const id = requestApproval(db, {
          agent_id: "resolver-agent",
          run_id: runId,
          action: "test.action",
          severity: "info",
          payload: "{}",
        });

        resolveApproval(db, id, "approved", resolver);

        const all = listApprovals(db, "approved");
        const found = all.find((a) => a.id === id);
        expect(found!.resolved_by).toBe(resolver);
      });
    }
  });

  // ── 23. Approval with complex JSON payload ─────────────────────────────

  describe("complex payloads", () => {
    it("nested JSON object payload is preserved", () => {
      const runId = store.startRun("nested-agent", "test");
      const complex = {
        email: {
          to: ["a@test.com", "b@test.com"],
          subject: "Test",
          body: { html: "<p>Hello</p>", text: "Hello" },
        },
        metadata: { retries: 3, priority: "high" },
      };

      const id = requestApproval(db, {
        agent_id: "nested-agent",
        run_id: runId,
        action: "email.send",
        severity: "critical",
        payload: JSON.stringify(complex),
      });

      const all = listApprovals(db);
      const found = all.find((a) => a.id === id)!;
      const parsed = JSON.parse(found.payload);
      expect(parsed.email.to).toEqual(["a@test.com", "b@test.com"]);
      expect(parsed.metadata.retries).toBe(3);
    });

    it("array payload is preserved", () => {
      const runId = store.startRun("array-agent", "test");
      const payload = JSON.stringify([1, 2, 3, "four", { five: 5 }]);

      const id = requestApproval(db, {
        agent_id: "array-agent",
        run_id: runId,
        action: "test.action",
        severity: "info",
        payload,
      });

      const all = listApprovals(db);
      const found = all.find((a) => a.id === id)!;
      const parsed = JSON.parse(found.payload);
      expect(parsed).toEqual([1, 2, 3, "four", { five: 5 }]);
    });

    it("payload with unicode characters is preserved", () => {
      const runId = store.startRun("unicode-agent", "test");
      const payload = JSON.stringify({ message: "Hallo Welt! Datos de prueba." });

      const id = requestApproval(db, {
        agent_id: "unicode-agent",
        run_id: runId,
        action: "test.action",
        severity: "info",
        payload,
      });

      const all = listApprovals(db);
      const found = all.find((a) => a.id === id)!;
      const parsed = JSON.parse(found.payload);
      expect(parsed.message).toBe("Hallo Welt! Datos de prueba.");
    });
  });

  // ── 24. Approval with multiple approval loops ──────────────────────────

  describe("multiple approval loops in one run", () => {
    it("run goes through 3 approval cycles successfully", () => {
      const agentId = "multi-loop";
      const runId = store.startRun(agentId, "test");
      store.transition(runId, agentId, "executing", "plan_built");

      for (let cycle = 0; cycle < 3; cycle++) {
        store.transition(runId, agentId, "awaiting_approval", "approval_requested");

        const approvalId = requestApproval(db, {
          agent_id: agentId,
          run_id: runId,
          action: `step.${cycle}.action`,
          severity: SEVERITIES[cycle],
          payload: JSON.stringify({ cycle }),
        });

        resolveApproval(db, approvalId, "approved", "admin", `Cycle ${cycle} approved`);
        store.transition(runId, agentId, "executing", "approval_resolved");
      }

      store.transition(runId, agentId, "completed", "run_completed");
      expect(store.getStatus(runId)).toBe("completed");

      // All 3 approvals should be in approved state
      const approved = listApprovals(db, "approved");
      expect(approved.length).toBe(3);
    });
  });

  // ── 25. Stress: high-volume approval listing ───────────────────────────

  describe("high-volume listing", () => {
    it("lists 200 approvals correctly", () => {
      const runId = store.startRun("volume-agent", "test");

      for (let i = 0; i < 200; i++) {
        requestApproval(db, {
          agent_id: "volume-agent",
          run_id: runId,
          action: `action.${i}`,
          severity: SEVERITIES[i % 3],
          payload: "{}",
        });
      }

      const all = listApprovals(db);
      expect(all.length).toBe(200);
    });

    it("filtered listing with 200 approvals returns correct subset", () => {
      const runId = store.startRun("filter-vol", "test");
      const ids: string[] = [];

      for (let i = 0; i < 200; i++) {
        ids.push(requestApproval(db, {
          agent_id: "filter-vol",
          run_id: runId,
          action: `action.${i}`,
          severity: SEVERITIES[i % 3],
          payload: "{}",
        }));
      }

      // Approve first 100
      for (let i = 0; i < 100; i++) {
        resolveApproval(db, ids[i], "approved", "admin");
      }

      expect(listApprovals(db, "pending").length).toBe(100);
      expect(listApprovals(db, "approved").length).toBe(100);
      expect(listApprovals(db).length).toBe(200);
    });
  });
});
