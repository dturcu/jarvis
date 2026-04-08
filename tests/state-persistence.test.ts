import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  configureJarvisStatePersistence,
  getJarvisState,
  resetJarvisState
} from "@jarvis/shared";

describe.sequential("Jarvis durable state persistence", () => {
  it("persists approvals, jobs, artifacts, and dispatches across a reload", { timeout: 15_000 }, () => {
    const tempDir = mkdtempSync(join(tmpdir(), "jarvis-state-"));
    const databasePath = join(tempDir, "state.sqlite");

    try {
      configureJarvisStatePersistence(null);
      resetJarvisState();

      configureJarvisStatePersistence({ filePath: databasePath });
      resetJarvisState();

      const approval = getJarvisState().requestApproval({
        title: "Approve follow-up broadcast",
        description: "Needed to persist a dispatch record through restart."
      });
      const resolvedApproval = getJarvisState().resolveApproval(
        approval.approval_id,
        "approved",
      );
      expect(resolvedApproval?.state).toBe("approved");

      const dispatchResponse = getJarvisState().createDispatch({
        kind: "dispatch_followup",
        text: "Please review the completed preview.",
        sessionKey: "agent:main:telegram:dm:123",
        approvalId: approval.approval_id
      });
      expect(dispatchResponse.status).toBe("accepted");

      const queued = getJarvisState().submitJob({
        type: "office.preview",
        input: {
          source_artifact: { artifact_id: "source-1" },
          format: "pdf",
          output_name: "preview.pdf"
        },
        artifactsIn: [{ artifact_id: "source-1" }]
      });

      expect(queued.status).toBe("accepted");
      expect(queued.job_id).toBeTruthy();

      const callback = {
        contract_version: "jarvis.v1" as const,
        job_id: queued.job_id!,
        job_type: "office.preview" as const,
        attempt: 1,
        status: "completed" as const,
        summary: "Rendered preview.pdf",
        worker_id: "office-worker-1",
        artifacts: [
          {
            artifact_id: "preview-1",
            kind: "pdf",
            name: "preview.pdf",
            path: "/data/artifacts/preview.pdf",
            path_context: "worker_fs",
            path_style: "posix"
          }
        ]
      };

      const completed = getJarvisState().handleWorkerCallback(callback);
      expect(completed.status).toBe("completed");
      expect(completed.artifacts).toEqual(callback.artifacts);

      expect(existsSync(databasePath)).toBe(true);
      const db = new DatabaseSync(databasePath);
      const jobCount = db.prepare("SELECT COUNT(*) AS count FROM jobs").get() as {
        count: number;
      };
      const approvalCount = db
        .prepare("SELECT COUNT(*) AS count FROM approvals")
        .get() as { count: number };
      const dispatchCount = db
        .prepare("SELECT COUNT(*) AS count FROM dispatches")
        .get() as { count: number };
      expect(jobCount.count).toBe(1);
      expect(approvalCount.count).toBe(1);
      expect(dispatchCount.count).toBe(1);
      db.close();

      resetJarvisState({ preservePersistence: true });
      configureJarvisStatePersistence({ filePath: databasePath });

      const reloadedApproval = getJarvisState().getApproval(approval.approval_id);
      expect(reloadedApproval).toMatchObject({
        approval_id: approval.approval_id,
        state: "approved",
        title: "Approve follow-up broadcast"
      });

      const reloadedJob = getJarvisState().getJob(queued.job_id!);
      expect(reloadedJob).toMatchObject({
        job_id: queued.job_id,
        status: "completed",
        summary: "Rendered preview.pdf"
      });
      expect(reloadedJob.artifacts).toEqual(callback.artifacts);

      const reloadedDispatches = getJarvisState().getDispatches();
      expect(reloadedDispatches).toHaveLength(1);
      expect(reloadedDispatches[0]).toMatchObject({
        kind: "dispatch_followup",
        text: "Please review the completed preview.",
        session_key: "agent:main:telegram:dm:123"
      });

      const duplicateCallbackResult = getJarvisState().handleWorkerCallback(callback);
      expect(duplicateCallbackResult).toMatchObject({
        job_id: queued.job_id,
        status: "completed",
        summary: "Rendered preview.pdf"
      });
      expect(duplicateCallbackResult.artifacts).toEqual(callback.artifacts);
    } finally {
      configureJarvisStatePersistence(null);
      resetJarvisState();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("migrates a legacy JSON snapshot into SQLite on first boot", { timeout: 15_000 }, () => {
    const tempDir = mkdtempSync(join(tmpdir(), "jarvis-state-migrate-"));
    const databasePath = join(tempDir, "state.sqlite");
    const legacySnapshotPath = join(tempDir, "state.json");

    try {
      writeFileSync(
        legacySnapshotPath,
        JSON.stringify(
          {
            contract_version: "jarvis.v1",
            version: 1,
            approvals: [
              {
                approval_id: "approval-1",
                state: "approved",
                title: "Approve broadcast",
                description: "Legacy approval",
                severity: "warning",
                scopes: ["dispatch_broadcast"],
                created_at: "2026-04-04T12:00:00.000Z",
                resolved_at: "2026-04-04T12:01:00.000Z"
              }
            ],
            jobs: [
              {
                envelope: {
                  contract_version: "jarvis.v1",
                  job_id: "job-1",
                  type: "office.preview",
                  session_key: "agent:main:telegram:dm:123",
                  requested_by: {
                    channel: "telegram",
                    user_id: "123"
                  },
                  priority: "normal",
                  approval_state: "not_required",
                  timeout_seconds: 300,
                  attempt: 1,
                  input: {
                    source_artifact: { artifact_id: "source-1" },
                    format: "pdf",
                    output_name: "preview.pdf"
                  },
                  artifacts_in: [{ artifact_id: "source-1" }],
                  metadata: {
                    agent_id: "main",
                    thread_key: null
                  }
                },
                result: {
                  contract_version: "jarvis.v1",
                  job_id: "job-1",
                  job_type: "office.preview",
                  status: "completed",
                  summary: "Migrated preview",
                  attempt: 1
                }
              }
            ],
            dispatches: [
              {
                dispatch_id: "dispatch-1",
                kind: "dispatch_followup",
                session_key: "agent:main:telegram:dm:123",
                text: "Legacy follow-up",
                created_at: "2026-04-04T12:02:00.000Z",
                delivery_status: "pending"
              }
            ]
          },
          null,
          2,
        ),
      );

      configureJarvisStatePersistence({
        databasePath,
        legacySnapshotPath
      });

      const reloadedApproval = getJarvisState().getApproval("approval-1");
      expect(reloadedApproval?.state).toBe("approved");

      const reloadedJob = getJarvisState().getJob("job-1");
      expect(reloadedJob.summary).toBe("Migrated preview");

      const reloadedDispatches = getJarvisState().getDispatches();
      expect(reloadedDispatches).toHaveLength(1);
      expect(reloadedDispatches[0]?.dispatch_id).toBe("dispatch-1");

      expect(existsSync(databasePath)).toBe(true);
    } finally {
      configureJarvisStatePersistence(null);
      resetJarvisState();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
