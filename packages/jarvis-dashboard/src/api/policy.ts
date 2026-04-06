/**
 * Policy matrix API endpoints.
 *
 * Exposes the JOB_APPROVAL_REQUIREMENT map from @jarvis/shared,
 * organized by approval category (autonomous / gated / conditional).
 */

import { Router } from "express";
import { JOB_APPROVAL_REQUIREMENT, type JarvisJobType } from "@jarvis/shared";

export const policyRouter = Router();

type PolicyCategory = "autonomous" | "gated" | "conditional";

function buildPolicyMatrix(): Record<PolicyCategory, string[]> {
  const matrix: Record<PolicyCategory, string[]> = {
    autonomous: [],
    gated: [],
    conditional: [],
  };

  for (const [action, requirement] of Object.entries(JOB_APPROVAL_REQUIREMENT)) {
    switch (requirement) {
      case "not_required":
        matrix.autonomous.push(action);
        break;
      case "required":
        matrix.gated.push(action);
        break;
      case "conditional":
        matrix.conditional.push(action);
        break;
    }
  }

  // Sort each category for stable output
  matrix.autonomous.sort();
  matrix.gated.sort();
  matrix.conditional.sort();

  return matrix;
}

// GET / — full policy matrix grouped by category
policyRouter.get("/", (_req, res) => {
  res.json(buildPolicyMatrix());
});

// GET /actions/:action — approval requirement for a specific action type
policyRouter.get("/actions/:action", (req, res) => {
  const action = req.params.action as string;
  const requirement = JOB_APPROVAL_REQUIREMENT[action as JarvisJobType];

  if (!requirement) {
    res.status(404).json({
      error: `Unknown action type: ${action}`,
      policy: "deny",
      message: "Unknown actions are denied by default.",
    });
    return;
  }

  res.json({
    action,
    approval: requirement,
    category:
      requirement === "not_required"
        ? "autonomous"
        : requirement === "required"
          ? "gated"
          : "conditional",
  });
});
