import { beforeEach, describe, expect, it } from "vitest";
import {
  getJarvisState,
  resetJarvisState,
  CONTRACT_VERSION
} from "@jarvis/shared";

describe("RT-805: Duplicate submission", () => {
  beforeEach(() => {
    resetJarvisState();
  });

  // ─── Same agent submitted twice rapidly ──────────────────────────────────
  // Uses agent.status (approval: not_required) so jobs are immediately claimable.

  describe("Same agent submitted twice rapidly", () => {
    it("creates separate job_ids for each submission", () => {
      const first = getJarvisState().submitJob({
        type: "agent.status",
        input: { agent_id: "test-agent" }
      });
      const second = getJarvisState().submitJob({
        type: "agent.status",
        input: { agent_id: "test-agent" }
      });

      expect(first.status).toBe("accepted");
      expect(second.status).toBe("accepted");
      expect(first.job_id).toBeTruthy();
      expect(second.job_id).toBeTruthy();
      expect(first.job_id).not.toBe(second.job_id);
    });

    it("both jobs appear in the jobs table", () => {
      getJarvisState().submitJob({
        type: "agent.status",
        input: { agent_id: "test-agent" }
      });
      getJarvisState().submitJob({
        type: "agent.status",
        input: { agent_id: "test-agent" }
      });

      const stats = getJarvisState().getStats();
      expect(stats.jobs).toBe(2);
    });

    it("claiming first leaves second still claimable", () => {
      const first = getJarvisState().submitJob({
        type: "agent.status",
        input: { agent_id: "test-agent" }
      });
      const second = getJarvisState().submitJob({
        type: "agent.status",
        input: { agent_id: "test-agent" }
      });

      // Claim first job
      const claim1 = getJarvisState().claimJob({
        worker_id: "worker-1",
        routes: ["agent"],
        lease_seconds: 60
      });
      expect(claim1).not.toBeNull();
      expect(claim1!.job_id).toBe(first.job_id);

      // Second job should still be claimable
      const claim2 = getJarvisState().claimJob({
        worker_id: "worker-2",
        routes: ["agent"],
        lease_seconds: 60
      });
      expect(claim2).not.toBeNull();
      expect(claim2!.job_id).toBe(second.job_id);
    });

    it("three identical submissions produce three independent jobs", () => {
      const jobs = Array.from({ length: 3 }, () =>
        getJarvisState().submitJob({
          type: "agent.status",
          input: { agent_id: "test-agent" }
        })
      );

      const ids = new Set(jobs.map((j) => j.job_id));
      expect(ids.size).toBe(3);
      expect(getJarvisState().getStats().jobs).toBe(3);
    });
  });

  // ─── Claim idempotency ───────────────────────────────────────────────────

  describe("Claim idempotency", () => {
    it("already-claimed job cannot be claimed again from same routes", () => {
      getJarvisState().submitJob({
        type: "agent.status",
        input: { agent_id: "test-agent" }
      });

      // First claim succeeds
      const claim1 = getJarvisState().claimJob({
        worker_id: "worker-1",
        routes: ["agent"],
        lease_seconds: 60
      });
      expect(claim1).not.toBeNull();
      expect(claim1!.claimed).toBe(true);

      // Second claim returns null (no more claimable jobs)
      const claim2 = getJarvisState().claimJob({
        worker_id: "worker-1",
        routes: ["agent"],
        lease_seconds: 60
      });
      expect(claim2).toBeNull();
    });

    it("already-claimed job cannot be claimed by a different worker", () => {
      getJarvisState().submitJob({
        type: "agent.status",
        input: { agent_id: "test-agent" }
      });

      getJarvisState().claimJob({
        worker_id: "worker-1",
        routes: ["agent"],
        lease_seconds: 60
      });

      const claim2 = getJarvisState().claimJob({
        worker_id: "worker-2",
        routes: ["agent"],
        lease_seconds: 60
      });
      expect(claim2).toBeNull();
    });

    it("claim with no queued jobs returns null", () => {
      const claim = getJarvisState().claimJob({
        worker_id: "worker-1",
        routes: ["agent"],
        lease_seconds: 60
      });
      expect(claim).toBeNull();
    });

    it("claim with wrong route prefix returns null", () => {
      getJarvisState().submitJob({
        type: "agent.status",
        input: { agent_id: "test-agent" }
      });

      const claim = getJarvisState().claimJob({
        worker_id: "worker-1",
        routes: ["office"],
        lease_seconds: 60
      });
      expect(claim).toBeNull();
    });

    it("completed job is not returned by subsequent claims", () => {
      const submitted = getJarvisState().submitJob({
        type: "agent.status",
        input: { agent_id: "test-agent" }
      });

      getJarvisState().claimJob({
        worker_id: "worker-1",
        routes: ["agent"],
        lease_seconds: 60
      });

      getJarvisState().handleWorkerCallback({
        contract_version: CONTRACT_VERSION,
        job_id: submitted.job_id!,
        job_type: "agent.status",
        attempt: 1,
        status: "completed",
        summary: "Done.",
        worker_id: "worker-1"
      });

      // Try to claim again - should get null
      const claim2 = getJarvisState().claimJob({
        worker_id: "worker-1",
        routes: ["agent"],
        lease_seconds: 60
      });
      expect(claim2).toBeNull();
    });
  });
});
