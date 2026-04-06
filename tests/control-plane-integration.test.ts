import { beforeEach, describe, expect, it } from "vitest";
import {
  getJarvisState,
  resetJarvisState,
  CONTRACT_VERSION
} from "@jarvis/shared";

describe("RT-801: Control plane integration", () => {
  beforeEach(() => {
    resetJarvisState();
  });

  // ─── Submit -> Queue -> Claim -> Complete ─────────────────────────────────

  describe("Submit -> Queue -> Claim -> Complete lifecycle", () => {
    it("submits a job and verifies it is queued", () => {
      const result = getJarvisState().submitJob({
        type: "agent.status",
        input: { agent_id: "test-agent" }
      });

      expect(result.status).toBe("accepted");
      expect(result.job_id).toBeTruthy();
      expect(result.summary).toContain("agent.status");
    });

    it("queued job is visible via getJob", () => {
      const submitted = getJarvisState().submitJob({
        type: "agent.status",
        input: { agent_id: "test-agent" }
      });

      const job = getJarvisState().getJob(submitted.job_id!);
      expect(job.status).toBe("accepted"); // ToolResponse maps queued -> accepted
      expect(job.job_id).toBe(submitted.job_id);
    });

    it("claims the queued job", () => {
      const submitted = getJarvisState().submitJob({
        type: "agent.status",
        input: { agent_id: "test-agent" }
      });

      const claim = getJarvisState().claimJob({
        worker_id: "test-worker",
        routes: ["agent"],
        lease_seconds: 60
      });

      expect(claim).not.toBeNull();
      expect(claim!.claimed).toBe(true);
      expect(claim!.job_id).toBe(submitted.job_id);
      expect(claim!.claim_id).toBeTruthy();
      expect(claim!.status).toBe("claimed");
      expect(claim!.job_type).toBe("agent.status");
    });

    it("completes the job via worker callback", () => {
      const submitted = getJarvisState().submitJob({
        type: "agent.status",
        input: { agent_id: "test-agent" }
      });

      getJarvisState().claimJob({
        worker_id: "test-worker",
        routes: ["agent"],
        lease_seconds: 60
      });

      const callbackResult = getJarvisState().handleWorkerCallback({
        contract_version: CONTRACT_VERSION,
        job_id: submitted.job_id!,
        job_type: "agent.status",
        attempt: 1,
        status: "completed",
        summary: "Agent test-agent finished successfully.",
        worker_id: "test-worker"
      });

      expect(callbackResult.status).toBe("completed");
      expect(callbackResult.summary).toBe("Agent test-agent finished successfully.");
    });

    it("completed job state is reflected via getJob", () => {
      const submitted = getJarvisState().submitJob({
        type: "agent.status",
        input: { agent_id: "test-agent" }
      });

      getJarvisState().claimJob({
        worker_id: "test-worker",
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
        worker_id: "test-worker"
      });

      const job = getJarvisState().getJob(submitted.job_id!);
      expect(job.status).toBe("completed");
      expect(job.summary).toBe("Done.");
    });

    it("full lifecycle preserves job_id across all stages", () => {
      const submitted = getJarvisState().submitJob({
        type: "agent.status",
        input: { agent_id: "test-agent" }
      });
      const jobId = submitted.job_id!;

      const claim = getJarvisState().claimJob({
        worker_id: "test-worker",
        routes: ["agent"],
        lease_seconds: 60
      });
      expect(claim!.job_id).toBe(jobId);

      const callback = getJarvisState().handleWorkerCallback({
        contract_version: CONTRACT_VERSION,
        job_id: jobId,
        job_type: "agent.status",
        attempt: 1,
        status: "completed",
        summary: "Complete.",
        worker_id: "test-worker"
      });
      expect(callback.job_id).toBe(jobId);

      const finalJob = getJarvisState().getJob(jobId);
      expect(finalJob.job_id).toBe(jobId);
      expect(finalJob.status).toBe("completed");
    });
  });

  // ─── Submit -> Approval required -> Resolve -> Complete ──────────────────

  describe("Submit -> Approval required -> Resolve -> Complete", () => {
    it("email.send requires approval and blocks submission", () => {
      const result = getJarvisState().submitJob({
        type: "email.send",
        input: { to: "test@example.com", subject: "Test", body: "Hello" }
      });

      expect(result.status).toBe("awaiting_approval");
      expect(result.approval_id).toBeTruthy();
      expect(result.summary).toContain("Approval required");
    });

    it("resolving approval changes it to approved", () => {
      const result = getJarvisState().submitJob({
        type: "email.send",
        input: { to: "test@example.com", subject: "Test", body: "Hello" }
      });

      const resolved = getJarvisState().resolveApproval(
        result.approval_id!,
        "approved"
      );

      expect(resolved).not.toBeNull();
      expect(resolved!.state).toBe("approved");
      expect(resolved!.resolved_at).toBeTruthy();
    });

    it("re-submitting with approved approvalId queues the job", () => {
      const blocked = getJarvisState().submitJob({
        type: "email.send",
        input: { to: "test@example.com", subject: "Test", body: "Hello" }
      });

      getJarvisState().resolveApproval(blocked.approval_id!, "approved");

      const queued = getJarvisState().submitJob({
        type: "email.send",
        input: { to: "test@example.com", subject: "Test", body: "Hello" },
        approvalId: blocked.approval_id!
      });

      expect(queued.status).toBe("accepted");
      expect(queued.job_id).toBeTruthy();
    });

    it("full approval flow: block -> approve -> submit -> claim -> complete", () => {
      const blocked = getJarvisState().submitJob({
        type: "email.send",
        input: { to: "test@example.com", subject: "Test", body: "Hello" }
      });
      expect(blocked.status).toBe("awaiting_approval");

      getJarvisState().resolveApproval(blocked.approval_id!, "approved");

      const queued = getJarvisState().submitJob({
        type: "email.send",
        input: { to: "test@example.com", subject: "Test", body: "Hello" },
        approvalId: blocked.approval_id!
      });
      expect(queued.status).toBe("accepted");

      const claim = getJarvisState().claimJob({
        worker_id: "email-worker",
        routes: ["email"],
        lease_seconds: 60
      });
      expect(claim).not.toBeNull();
      expect(claim!.job_id).toBe(queued.job_id);

      const callback = getJarvisState().handleWorkerCallback({
        contract_version: CONTRACT_VERSION,
        job_id: queued.job_id!,
        job_type: "email.send",
        attempt: 1,
        status: "completed",
        summary: "Email sent.",
        worker_id: "email-worker"
      });
      expect(callback.status).toBe("completed");
    });
  });

  // ─── Multiple sources produce identical state ────────────────────────────

  describe("Multiple sources produce identical state", () => {
    it("jobs from different channels all land in the same queue", () => {
      const dashboardJob = getJarvisState().submitJob({
        type: "agent.status",
        input: { agent_id: "bd-pipeline" },
        ctx: {
          agentId: "main",
          sessionKey: "agent:main:dashboard:web:user1",
          messageChannel: "dashboard",
          requesterSenderId: "user1"
        }
      });

      const telegramJob = getJarvisState().submitJob({
        type: "agent.status",
        input: { agent_id: "bd-pipeline" },
        ctx: {
          agentId: "main",
          sessionKey: "agent:main:telegram:dm:456",
          messageChannel: "telegram",
          requesterSenderId: "456"
        }
      });

      const apiJob = getJarvisState().submitJob({
        type: "agent.status",
        input: { agent_id: "bd-pipeline" },
        ctx: {
          agentId: "main",
          sessionKey: "agent:main:api:webhook:sys",
          messageChannel: "api",
          requesterSenderId: "sys"
        }
      });

      expect(dashboardJob.status).toBe("accepted");
      expect(telegramJob.status).toBe("accepted");
      expect(apiJob.status).toBe("accepted");

      // All three are distinct jobs
      const ids = new Set([
        dashboardJob.job_id,
        telegramJob.job_id,
        apiJob.job_id
      ]);
      expect(ids.size).toBe(3);

      // Stats confirm all three are in the jobs table
      const stats = getJarvisState().getStats();
      expect(stats.jobs).toBe(3);
    });

    it("jobs from different channels are all claimable by the same worker", () => {
      getJarvisState().submitJob({
        type: "agent.status",
        input: { agent_id: "test-1" },
        ctx: {
          agentId: "main",
          sessionKey: "agent:main:dashboard:web:u1",
          messageChannel: "dashboard",
          requesterSenderId: "u1"
        }
      });

      getJarvisState().submitJob({
        type: "agent.status",
        input: { agent_id: "test-2" },
        ctx: {
          agentId: "main",
          sessionKey: "agent:main:telegram:dm:u2",
          messageChannel: "telegram",
          requesterSenderId: "u2"
        }
      });

      // Claim first
      const claim1 = getJarvisState().claimJob({
        worker_id: "worker-1",
        routes: ["agent"],
        lease_seconds: 60
      });
      expect(claim1).not.toBeNull();

      // Complete first so second becomes claimable
      getJarvisState().handleWorkerCallback({
        contract_version: CONTRACT_VERSION,
        job_id: claim1!.job_id!,
        job_type: "agent.status",
        attempt: 1,
        status: "completed",
        summary: "Done.",
        worker_id: "worker-1"
      });

      // Claim second
      const claim2 = getJarvisState().claimJob({
        worker_id: "worker-1",
        routes: ["agent"],
        lease_seconds: 60
      });
      expect(claim2).not.toBeNull();
      expect(claim2!.job_id).not.toBe(claim1!.job_id);
    });
  });
});
