import { beforeEach, describe, expect, it } from "vitest";
import {
  getJarvisState,
  resetJarvisState,
  CONTRACT_VERSION
} from "@jarvis/shared";

describe("RT-803: Crash recovery", () => {
  beforeEach(() => {
    resetJarvisState();
  });

  // ─── Expired lease requeue ─────────────────────────────────────────────

  describe("Expired lease requeue", () => {
    it("requeues a running job whose lease has expired", () => {
      const submitted = getJarvisState().submitJob({
        type: "office.preview",
        input: {
          source_artifact: { artifact_id: "a1" },
          format: "pdf",
          output_name: "preview.pdf"
        }
      });

      // Claim with a very short lease
      const claim = getJarvisState().claimJob({
        worker_id: "test-worker",
        routes: ["office"],
        lease_seconds: 1
      });
      expect(claim).not.toBeNull();
      expect(claim!.job_id).toBe(submitted.job_id);

      // Verify job is running
      const runningJob = getJarvisState().getJob(submitted.job_id!);
      expect(runningJob.status).toBe("in_progress");

      // Force the lease_expires_at into the past by manipulating the record
      // We'll use the internal DB through a second claim approach:
      // Instead, wait for actual expiry with a 1-second lease. Use requeueExpiredJobs
      // after enough time. But we can manipulate the clock by setting requested_at in the past.
      const pastTime = new Date(Date.now() - 120_000).toISOString();
      const claimWithPastTime = getJarvisState();

      // Re-submit and claim with a past requested_at so lease is already expired
      resetJarvisState();
      const submitted2 = getJarvisState().submitJob({
        type: "office.preview",
        input: {
          source_artifact: { artifact_id: "a2" },
          format: "pdf",
          output_name: "preview2.pdf"
        }
      });

      getJarvisState().claimJob({
        worker_id: "test-worker",
        routes: ["office"],
        lease_seconds: 5,
        requested_at: new Date(Date.now() - 120_000).toISOString()
      });

      // Now the lease should have expired (it was set 120s in the past + 5s = 115s ago)
      const requeued = getJarvisState().requeueExpiredJobs();
      expect(requeued).toBe(1);

      // Verify job is back to queued
      const job = getJarvisState().getJob(submitted2.job_id!);
      expect(job.status).toBe("accepted"); // ToolResponse maps queued -> accepted
      expect(job.summary).toContain("Re-queued");
    });

    it("requeued job can be claimed again", () => {
      const submitted = getJarvisState().submitJob({
        type: "office.preview",
        input: {
          source_artifact: { artifact_id: "a1" },
          format: "pdf",
          output_name: "preview.pdf"
        }
      });

      // Claim with expired lease
      getJarvisState().claimJob({
        worker_id: "worker-1",
        routes: ["office"],
        lease_seconds: 5,
        requested_at: new Date(Date.now() - 120_000).toISOString()
      });

      getJarvisState().requeueExpiredJobs();

      // Claim again with a different worker
      const newClaim = getJarvisState().claimJob({
        worker_id: "worker-2",
        routes: ["office"],
        lease_seconds: 60
      });

      expect(newClaim).not.toBeNull();
      expect(newClaim!.claimed).toBe(true);
      expect(newClaim!.job_id).toBe(submitted.job_id);
    });

    it("requeueExpiredJobs returns 0 when no leases are expired", () => {
      getJarvisState().submitJob({
        type: "office.preview",
        input: {
          source_artifact: { artifact_id: "a1" },
          format: "pdf",
          output_name: "preview.pdf"
        }
      });

      // Claim with a long lease
      getJarvisState().claimJob({
        worker_id: "test-worker",
        routes: ["office"],
        lease_seconds: 3600
      });

      const requeued = getJarvisState().requeueExpiredJobs();
      expect(requeued).toBe(0);
    });

    it("requeueExpiredJobs with no running jobs returns 0", () => {
      getJarvisState().submitJob({
        type: "agent.status",
        input: { agent_id: "test" }
      });

      const requeued = getJarvisState().requeueExpiredJobs();
      expect(requeued).toBe(0);
    });
  });

  // ─── Terminal states are untouched by requeue ────────────────────────────

  describe("Terminal states are untouched by requeue", () => {
    it("completed job is not affected by requeueExpiredJobs", () => {
      const submitted = getJarvisState().submitJob({
        type: "office.preview",
        input: {
          source_artifact: { artifact_id: "a1" },
          format: "pdf",
          output_name: "preview.pdf"
        }
      });

      getJarvisState().claimJob({
        worker_id: "test-worker",
        routes: ["office"],
        lease_seconds: 5,
        requested_at: new Date(Date.now() - 120_000).toISOString()
      });

      getJarvisState().handleWorkerCallback({
        contract_version: CONTRACT_VERSION,
        job_id: submitted.job_id!,
        job_type: "office.preview",
        attempt: 1,
        status: "completed",
        summary: "Preview rendered.",
        worker_id: "test-worker"
      });

      const requeued = getJarvisState().requeueExpiredJobs();
      expect(requeued).toBe(0);

      const job = getJarvisState().getJob(submitted.job_id!);
      expect(job.status).toBe("completed");
      expect(job.summary).toBe("Preview rendered.");
    });

    it("failed job is not affected by requeueExpiredJobs", () => {
      const submitted = getJarvisState().submitJob({
        type: "office.preview",
        input: {
          source_artifact: { artifact_id: "a1" },
          format: "pdf",
          output_name: "preview.pdf"
        }
      });

      getJarvisState().claimJob({
        worker_id: "test-worker",
        routes: ["office"],
        lease_seconds: 5,
        requested_at: new Date(Date.now() - 120_000).toISOString()
      });

      getJarvisState().handleWorkerCallback({
        contract_version: CONTRACT_VERSION,
        job_id: submitted.job_id!,
        job_type: "office.preview",
        attempt: 1,
        status: "failed",
        summary: "Preview failed.",
        worker_id: "test-worker",
        error: { code: "RENDER_ERROR", message: "Failed to render", retryable: true }
      });

      const requeued = getJarvisState().requeueExpiredJobs();
      expect(requeued).toBe(0);

      const job = getJarvisState().getJob(submitted.job_id!);
      expect(job.status).toBe("failed");
    });

    it("cancelled job is not affected by requeueExpiredJobs", () => {
      const submitted = getJarvisState().submitJob({
        type: "office.preview",
        input: {
          source_artifact: { artifact_id: "a1" },
          format: "pdf",
          output_name: "preview.pdf"
        }
      });

      getJarvisState().cancelJob(submitted.job_id!);

      const requeued = getJarvisState().requeueExpiredJobs();
      expect(requeued).toBe(0);

      const job = getJarvisState().getJob(submitted.job_id!);
      expect(job.status).toBe("cancelled");
    });

    it("mix of terminal and expired jobs: only expired ones are requeued", () => {
      // Submit three jobs
      const job1 = getJarvisState().submitJob({
        type: "office.preview",
        input: { source_artifact: { artifact_id: "a1" }, format: "pdf", output_name: "p1.pdf" }
      });
      const job2 = getJarvisState().submitJob({
        type: "office.inspect",
        input: { target_artifacts: [{ artifact_id: "a2" }] }
      });
      const job3 = getJarvisState().submitJob({
        type: "office.extract_tables",
        input: { source_artifact: { artifact_id: "a3" } }
      });

      // Claim all three with expired leases
      for (const jobType of ["office"] as const) {
        getJarvisState().claimJob({
          worker_id: "worker-1",
          routes: [jobType],
          lease_seconds: 5,
          requested_at: new Date(Date.now() - 120_000).toISOString()
        });
      }
      getJarvisState().claimJob({
        worker_id: "worker-1",
        routes: ["office"],
        lease_seconds: 5,
        requested_at: new Date(Date.now() - 120_000).toISOString()
      });
      getJarvisState().claimJob({
        worker_id: "worker-1",
        routes: ["office"],
        lease_seconds: 5,
        requested_at: new Date(Date.now() - 120_000).toISOString()
      });

      // Complete job1
      getJarvisState().handleWorkerCallback({
        contract_version: CONTRACT_VERSION,
        job_id: job1.job_id!,
        job_type: "office.preview",
        attempt: 1,
        status: "completed",
        summary: "Done.",
        worker_id: "worker-1"
      });

      // Fail job2
      getJarvisState().handleWorkerCallback({
        contract_version: CONTRACT_VERSION,
        job_id: job2.job_id!,
        job_type: "office.inspect",
        attempt: 1,
        status: "failed",
        summary: "Error.",
        worker_id: "worker-1",
        error: { code: "ERR", message: "fail", retryable: false }
      });

      // job3 is still running with expired lease
      const requeued = getJarvisState().requeueExpiredJobs();
      expect(requeued).toBe(1);

      expect(getJarvisState().getJob(job1.job_id!).status).toBe("completed");
      expect(getJarvisState().getJob(job2.job_id!).status).toBe("failed");
      expect(getJarvisState().getJob(job3.job_id!).status).toBe("accepted"); // queued -> accepted
    });
  });
});
