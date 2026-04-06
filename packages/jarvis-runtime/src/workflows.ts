export type WorkflowInput = {
  name: string;
  label: string;
  type: "text" | "file" | "select" | "date" | "checkbox";
  required: boolean;
  placeholder?: string;
  options?: string[];
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
  },
];
