import { describe, expect, it } from "vitest";
import {
  classifyDisagreement,
  shouldBlockExecution,
  shouldFlagForReview,
  DEFAULT_DISAGREEMENT_POLICY,
  MODERATE_DISAGREEMENT_POLICY,
  MINOR_DISAGREEMENT_POLICY,
  type DisagreementPolicy,
} from "@jarvis/runtime";

describe("classifyDisagreement", () => {
  it("no disagreement returns 'minor'", () => {
    const result = classifyDisagreement(
      { disagreement: false, reason: "plans_agree" },
      DEFAULT_DISAGREEMENT_POLICY,
    );
    expect(result).toBe("minor");
  });

  it("single-dimension disagreement (actions only) uses policy's on_disagreement setting", () => {
    const policy: DisagreementPolicy = {
      action_threshold: 0.3,
      step_ratio_threshold: 1.5,
      on_disagreement: "moderate",
      approval_timeout_ms: 0,
    };
    const result = classifyDisagreement(
      { disagreement: true, reason: "plans_use_different_actions" },
      policy,
    );
    expect(result).toBe("moderate");
  });

  it("single-dimension disagreement (steps only) uses policy's on_disagreement setting", () => {
    const policy: DisagreementPolicy = {
      action_threshold: 0.3,
      step_ratio_threshold: 1.5,
      on_disagreement: "moderate",
      approval_timeout_ms: 0,
    };
    const result = classifyDisagreement(
      { disagreement: true, reason: "plans_differ_in_scope" },
      policy,
    );
    expect(result).toBe("moderate");
  });

  it("substantial disagreement (both heuristics) always returns 'severe' regardless of policy", () => {
    const result = classifyDisagreement(
      { disagreement: true, reason: "plans_differ_substantially_in_structure_and_actions" },
      MINOR_DISAGREEMENT_POLICY,
    );
    expect(result).toBe("severe");
  });

  it("with DEFAULT_DISAGREEMENT_POLICY: single-dimension returns 'severe'", () => {
    const result = classifyDisagreement(
      { disagreement: true, reason: "plans_use_different_actions" },
      DEFAULT_DISAGREEMENT_POLICY,
    );
    expect(result).toBe("severe");
  });

  it("with MODERATE_DISAGREEMENT_POLICY: single-dimension returns 'moderate'", () => {
    const result = classifyDisagreement(
      { disagreement: true, reason: "plans_differ_in_scope" },
      MODERATE_DISAGREEMENT_POLICY,
    );
    expect(result).toBe("moderate");
  });

  it("with MINOR_DISAGREEMENT_POLICY: single-dimension returns 'minor'", () => {
    const result = classifyDisagreement(
      { disagreement: true, reason: "plans_use_different_actions" },
      MINOR_DISAGREEMENT_POLICY,
    );
    expect(result).toBe("minor");
  });
});

describe("shouldBlockExecution", () => {
  it("'severe' blocks execution", () => {
    expect(shouldBlockExecution("severe")).toBe(true);
  });

  it("'moderate' does not block", () => {
    expect(shouldBlockExecution("moderate")).toBe(false);
  });

  it("'minor' does not block", () => {
    expect(shouldBlockExecution("minor")).toBe(false);
  });
});

describe("shouldFlagForReview", () => {
  it("'severe' flags for review", () => {
    expect(shouldFlagForReview("severe")).toBe(true);
  });

  it("'moderate' flags for review", () => {
    expect(shouldFlagForReview("moderate")).toBe(true);
  });

  it("'minor' does not flag", () => {
    expect(shouldFlagForReview("minor")).toBe(false);
  });
});

describe("policy defaults", () => {
  it("DEFAULT_DISAGREEMENT_POLICY has on_disagreement: 'severe'", () => {
    expect(DEFAULT_DISAGREEMENT_POLICY.on_disagreement).toBe("severe");
  });

  it("MODERATE_DISAGREEMENT_POLICY has on_disagreement: 'moderate'", () => {
    expect(MODERATE_DISAGREEMENT_POLICY.on_disagreement).toBe("moderate");
  });

  it("MINOR_DISAGREEMENT_POLICY has on_disagreement: 'minor'", () => {
    expect(MINOR_DISAGREEMENT_POLICY.on_disagreement).toBe("minor");
  });

  it("all policies have positive action_threshold and step_ratio_threshold", () => {
    for (const policy of [
      DEFAULT_DISAGREEMENT_POLICY,
      MODERATE_DISAGREEMENT_POLICY,
      MINOR_DISAGREEMENT_POLICY,
    ]) {
      expect(policy.action_threshold).toBeGreaterThan(0);
      expect(policy.step_ratio_threshold).toBeGreaterThan(0);
    }
  });
});
