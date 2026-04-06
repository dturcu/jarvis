import { beforeEach, describe, expect, it } from "vitest";
import {
  getJarvisState,
  resetJarvisState
} from "@jarvis/shared";

describe("RT-802: Approval resolution consistency", () => {
  beforeEach(() => {
    resetJarvisState();
  });

  // ─── Resolve approval changes state ──────────────────────────────────────

  describe("Resolve approval changes state", () => {
    it("newly requested approval is pending", () => {
      const approval = getJarvisState().requestApproval({
        title: "Approve email send",
        description: "Sending follow-up email."
      });

      expect(approval.state).toBe("pending");
      expect(approval.approval_id).toBeTruthy();
      expect(approval.created_at).toBeTruthy();
      expect(approval.resolved_at).toBeUndefined();
    });

    it("resolving as approved sets state and resolved_at", () => {
      const approval = getJarvisState().requestApproval({
        title: "Approve email send",
        description: "Sending follow-up email."
      });

      const resolved = getJarvisState().resolveApproval(
        approval.approval_id,
        "approved"
      );

      expect(resolved).not.toBeNull();
      expect(resolved!.state).toBe("approved");
      expect(resolved!.resolved_at).toBeTruthy();
      expect(resolved!.approval_id).toBe(approval.approval_id);
    });

    it("resolving as rejected sets state and resolved_at", () => {
      const approval = getJarvisState().requestApproval({
        title: "Approve dangerous action",
        description: "Running untrusted code."
      });

      const resolved = getJarvisState().resolveApproval(
        approval.approval_id,
        "rejected"
      );

      expect(resolved).not.toBeNull();
      expect(resolved!.state).toBe("rejected");
      expect(resolved!.resolved_at).toBeTruthy();
    });

    it("resolving as expired sets state correctly", () => {
      const approval = getJarvisState().requestApproval({
        title: "Time-sensitive approval",
        description: "Must respond within 5 minutes."
      });

      const resolved = getJarvisState().resolveApproval(
        approval.approval_id,
        "expired"
      );

      expect(resolved).not.toBeNull();
      expect(resolved!.state).toBe("expired");
      expect(resolved!.resolved_at).toBeTruthy();
    });

    it("resolving as cancelled sets state correctly", () => {
      const approval = getJarvisState().requestApproval({
        title: "Cancellable approval",
        description: "User may cancel."
      });

      const resolved = getJarvisState().resolveApproval(
        approval.approval_id,
        "cancelled"
      );

      expect(resolved).not.toBeNull();
      expect(resolved!.state).toBe("cancelled");
      expect(resolved!.resolved_at).toBeTruthy();
    });

    it("getApproval retrieves the resolved state", () => {
      const approval = getJarvisState().requestApproval({
        title: "Test approval",
        description: "Test."
      });

      getJarvisState().resolveApproval(approval.approval_id, "approved");

      const fetched = getJarvisState().getApproval(approval.approval_id);
      expect(fetched).not.toBeNull();
      expect(fetched!.state).toBe("approved");
      expect(fetched!.resolved_at).toBeTruthy();
      expect(fetched!.title).toBe("Test approval");
    });
  });

  // ─── Double resolution behavior ─────────────────────────────────────────

  describe("Double resolution", () => {
    it("resolving an already-approved approval overwrites with new state", () => {
      const approval = getJarvisState().requestApproval({
        title: "Test double resolve",
        description: "Test."
      });

      getJarvisState().resolveApproval(approval.approval_id, "approved");

      // Second resolution attempt
      const secondResolve = getJarvisState().resolveApproval(
        approval.approval_id,
        "rejected"
      );

      // JarvisState.resolveApproval always overwrites (no guard on already-resolved)
      // Verify we get a result back (not null)
      expect(secondResolve).not.toBeNull();

      // Check what the actual stored state is
      const fetched = getJarvisState().getApproval(approval.approval_id);
      expect(fetched).not.toBeNull();
      // The implementation does an unconditional write, so the second resolve wins
      expect(fetched!.state).toBe("rejected");
    });

    it("double resolution with same state is a no-op in effect", () => {
      const approval = getJarvisState().requestApproval({
        title: "Idempotent resolve",
        description: "Test."
      });

      const first = getJarvisState().resolveApproval(
        approval.approval_id,
        "approved"
      );
      const second = getJarvisState().resolveApproval(
        approval.approval_id,
        "approved"
      );

      expect(first).not.toBeNull();
      expect(second).not.toBeNull();
      expect(first!.state).toBe("approved");
      expect(second!.state).toBe("approved");

      const fetched = getJarvisState().getApproval(approval.approval_id);
      expect(fetched!.state).toBe("approved");
    });
  });

  // ─── Edge cases ──────────────────────────────────────────────────────────

  describe("Edge cases", () => {
    it("resolving a nonexistent approval returns null", () => {
      const result = getJarvisState().resolveApproval(
        "nonexistent-approval-id",
        "approved"
      );
      expect(result).toBeNull();
    });

    it("getApproval for nonexistent id returns null", () => {
      const result = getJarvisState().getApproval("nonexistent-id");
      expect(result).toBeNull();
    });

    it("approval preserves severity and scopes through resolution", () => {
      const approval = getJarvisState().requestApproval({
        title: "Critical action",
        description: "Requires critical approval.",
        severity: "critical",
        scopes: ["email.send", "social.post"]
      });

      getJarvisState().resolveApproval(approval.approval_id, "approved");

      const fetched = getJarvisState().getApproval(approval.approval_id);
      expect(fetched!.severity).toBe("critical");
      expect(fetched!.scopes).toEqual(["email.send", "social.post"]);
    });

    it("multiple approvals are independent", () => {
      const approval1 = getJarvisState().requestApproval({
        title: "First approval",
        description: "Test 1."
      });
      const approval2 = getJarvisState().requestApproval({
        title: "Second approval",
        description: "Test 2."
      });

      // Approve first, reject second
      getJarvisState().resolveApproval(approval1.approval_id, "approved");
      getJarvisState().resolveApproval(approval2.approval_id, "rejected");

      const fetched1 = getJarvisState().getApproval(approval1.approval_id);
      const fetched2 = getJarvisState().getApproval(approval2.approval_id);

      expect(fetched1!.state).toBe("approved");
      expect(fetched2!.state).toBe("rejected");
    });

    it("approval created by submitJob for required type is fetchable", () => {
      const result = getJarvisState().submitJob({
        type: "email.send",
        input: { to: "test@example.com", subject: "Test", body: "Hello" }
      });

      expect(result.approval_id).toBeTruthy();

      const approval = getJarvisState().getApproval(result.approval_id!);
      expect(approval).not.toBeNull();
      expect(approval!.state).toBe("pending");
      expect(approval!.title).toContain("email.send");
    });
  });
});
