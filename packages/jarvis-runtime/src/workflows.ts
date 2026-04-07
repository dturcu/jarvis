export type WorkflowInput = {
  name: string;
  label: string;
  type: "text" | "file" | "select" | "date" | "checkbox";
  required: boolean;
  placeholder?: string;
  options?: string[];
};

export type WorkflowOutputField = {
  name: string;
  label: string;
  type: "text" | "list" | "document" | "table";
  required: boolean;
};

export type WorkflowSafetyRules = {
  outbound_default: "draft" | "send" | "blocked";
  preview_recommended: boolean;
  retry_safe: boolean;
  retry_requires_approval: boolean;
};

export type WorkflowDefinition = {
  workflow_id: string;
  name: string;
  description: string;
  agent_ids: string[];
  expected_output: string;
  inputs: WorkflowInput[];
  approval_summary: string;
  preview_available: boolean;
  output_fields?: WorkflowOutputField[];
  safety_rules?: WorkflowSafetyRules;
  /** Pack classification. All V1 workflows are core. */
  pack?: "core" | "experimental" | "personal";
};

export const V1_WORKFLOWS: WorkflowDefinition[] = [
  {
    workflow_id: "contract-review",
    name: "Review Contract",
    description: "Analyze NDA/MSA clauses and produce sign, negotiate, or escalate recommendation.",
    agent_ids: ["contract-reviewer"],
    expected_output: "Clause analysis with sign/negotiate/escalate recommendation",
    inputs: [
      { name: "document", label: "Contract document", type: "file", required: true, placeholder: "Upload NDA or MSA" },
      { name: "jurisdiction", label: "Jurisdiction", type: "select", required: false, options: ["EU", "US", "UK", "Other"] },
    ],
    approval_summary: "Report generation requires approval",
    preview_available: true,
    pack: "core",
    output_fields: [
      { name: "recommendation", label: "Overall recommendation", type: "text", required: true },
      { name: "risks", label: "Identified risks", type: "list", required: true },
      { name: "clause_analysis", label: "Clause-by-clause analysis", type: "table", required: true },
      { name: "next_actions", label: "Suggested next actions", type: "list", required: true },
    ],
    safety_rules: {
      outbound_default: "draft",
      preview_recommended: true,
      retry_safe: true,
      retry_requires_approval: false,
    },
  },
  {
    workflow_id: "rfq-analysis",
    name: "Analyze RFQ/Document",
    description: "Scan project documents for ISO 26262 compliance and build quote structure.",
    agent_ids: ["evidence-auditor", "proposal-engine"],
    expected_output: "Gap matrix and/or quote structure",
    inputs: [
      { name: "document", label: "RFQ or project document", type: "file", required: true },
      { name: "scope", label: "Analysis scope", type: "select", required: false, options: ["Full audit", "Gap analysis only", "Quote only"] },
    ],
    approval_summary: "Outbound emails require approval",
    preview_available: true,
    pack: "core",
    output_fields: [
      { name: "summary", label: "Analysis summary", type: "text", required: true },
      { name: "gap_matrix", label: "Compliance gap matrix", type: "table", required: true },
      { name: "recommendations", label: "Recommendations", type: "list", required: true },
    ],
    safety_rules: {
      outbound_default: "draft",
      preview_recommended: true,
      retry_safe: true,
      retry_requires_approval: false,
    },
  },
  {
    workflow_id: "bd-pipeline",
    name: "Monitor BD Pipeline",
    description: "Scan for business development signals, enrich leads, draft outreach, update CRM.",
    agent_ids: ["bd-pipeline"],
    expected_output: "Enriched leads, CRM updates, outreach drafts",
    inputs: [
      { name: "focus", label: "Focus area", type: "text", required: false, placeholder: "e.g., automotive OEMs in Germany" },
    ],
    approval_summary: "Emails and CRM stage changes require approval",
    preview_available: true,
    pack: "core",
    output_fields: [
      { name: "leads", label: "Enriched leads", type: "list", required: true },
      { name: "crm_updates", label: "CRM updates made", type: "list", required: false },
      { name: "outreach_drafts", label: "Outreach drafts", type: "list", required: false },
    ],
    safety_rules: {
      outbound_default: "draft",
      preview_recommended: false,
      retry_safe: false,
      retry_requires_approval: true,
    },
  },
  {
    workflow_id: "staffing-check",
    name: "Check Staffing",
    description: "Calculate team utilization, forecast gaps, match skills to pipeline.",
    agent_ids: ["staffing-monitor"],
    expected_output: "Utilization report with gap forecast",
    inputs: [
      { name: "period", label: "Report period", type: "select", required: false, options: ["This week", "Next 2 weeks", "This month", "This quarter"] },
    ],
    approval_summary: "Email notifications require approval",
    preview_available: false,
    pack: "core",
    output_fields: [
      { name: "utilization", label: "Utilization report", type: "text", required: true },
      { name: "gaps", label: "Forecasted gaps", type: "list", required: true },
    ],
    safety_rules: {
      outbound_default: "blocked",
      preview_recommended: false,
      retry_safe: true,
      retry_requires_approval: false,
    },
  },
  {
    workflow_id: "weekly-report",
    name: "Create Weekly Report",
    description: "Run scheduled monitoring agents and compile a weekly summary.",
    agent_ids: ["evidence-auditor", "staffing-monitor", "bd-pipeline"],
    expected_output: "Weekly summary report with action items",
    inputs: [
      { name: "week", label: "Report week", type: "date", required: false, placeholder: "Defaults to current week" },
    ],
    approval_summary: "Individual agent approvals apply",
    preview_available: false,
    pack: "core",
    output_fields: [
      { name: "summary", label: "Weekly summary", type: "text", required: true },
      { name: "action_items", label: "Action items", type: "list", required: true },
    ],
    safety_rules: {
      outbound_default: "draft",
      preview_recommended: false,
      retry_safe: true,
      retry_requires_approval: false,
    },
  },
];
