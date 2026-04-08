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
  pack?: "core" | "experimental" | "personal";
};

/**
 * V1 Workflows — rebuilt for the 8-agent production roster (2026-04-08).
 *
 * Each workflow maps to one or more active agents.
 * Removed responsibilities absorbed as noted in AGENT-MIGRATION-MAP.md.
 */
export const V1_WORKFLOWS: WorkflowDefinition[] = [
  // ── Core business workflows ──────────────────────────────────────

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
    description: "Run monitoring agents and compile a weekly summary.",
    agent_ids: ["evidence-auditor", "staffing-monitor", "regulatory-watch"],
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

  // ── Replacement workflows (absorbed from retired agents) ─────────

  {
    workflow_id: "meeting-ingestion",
    name: "Ingest Meeting Recording",
    description: "Transcribe meeting, extract minutes, link to CRM contacts. Owned by knowledge-curator.",
    agent_ids: ["knowledge-curator"],
    expected_output: "Structured meeting minutes with action items",
    inputs: [
      { name: "recording", label: "Meeting recording or transcript", type: "file", required: true },
      { name: "engagement", label: "Related engagement", type: "text", required: false, placeholder: "e.g., Volvo-Alpha" },
    ],
    approval_summary: "No approval needed (read-only ingestion)",
    preview_available: false,
    pack: "core",
    output_fields: [
      { name: "minutes", label: "Structured minutes", type: "document", required: true },
      { name: "action_items", label: "Action items", type: "list", required: true },
      { name: "attendees", label: "Attendees linked", type: "list", required: true },
    ],
    safety_rules: {
      outbound_default: "blocked",
      preview_recommended: false,
      retry_safe: true,
      retry_requires_approval: false,
    },
  },
  {
    workflow_id: "invoice-generation",
    name: "Generate Invoice",
    description: "Generate milestone invoice from CRM engagement data. Owned by proposal-engine.",
    agent_ids: ["proposal-engine"],
    expected_output: "Invoice document with cover email draft",
    inputs: [
      { name: "engagement", label: "Engagement ID", type: "text", required: true, placeholder: "e.g., garrett-2026" },
      { name: "milestone", label: "Milestone", type: "text", required: false, placeholder: "e.g., Phase 1 complete" },
    ],
    approval_summary: "Email with invoice requires approval",
    preview_available: true,
    pack: "core",
    output_fields: [
      { name: "invoice", label: "Invoice document", type: "document", required: true },
      { name: "cover_email", label: "Cover email draft", type: "text", required: true },
    ],
    safety_rules: {
      outbound_default: "draft",
      preview_recommended: true,
      retry_safe: true,
      retry_requires_approval: false,
    },
  },
  {
    workflow_id: "document-ingestion",
    name: "Ingest Document",
    description: "Parse, classify, and store a document in the knowledge store. Owned by knowledge-curator.",
    agent_ids: ["knowledge-curator"],
    expected_output: "Document ingested with metadata and entity links",
    inputs: [
      { name: "document", label: "Document to ingest", type: "file", required: true },
      { name: "collection", label: "Target collection", type: "select", required: false, options: ["proposals", "case-studies", "contracts", "playbooks", "iso26262", "regulatory", "meetings"] },
    ],
    approval_summary: "No approval needed",
    preview_available: false,
    pack: "core",
    output_fields: [
      { name: "ingestion_log", label: "Ingestion result", type: "text", required: true },
      { name: "entities", label: "Entities linked", type: "list", required: false },
    ],
    safety_rules: {
      outbound_default: "blocked",
      preview_recommended: false,
      retry_safe: true,
      retry_requires_approval: false,
    },
  },
  {
    workflow_id: "regulatory-scan",
    name: "Scan Regulatory Changes",
    description: "Check for standards and regulatory changes affecting TIC engagements.",
    agent_ids: ["regulatory-watch"],
    expected_output: "New regulatory findings or weekly digest",
    inputs: [
      { name: "standards", label: "Standards to check", type: "text", required: false, placeholder: "e.g., ISO 26262, ISO 21434 (defaults to all)" },
    ],
    approval_summary: "No approval needed (intelligence gathering)",
    preview_available: false,
    pack: "core",
    output_fields: [
      { name: "findings", label: "New findings", type: "list", required: true },
      { name: "digest", label: "Weekly digest", type: "document", required: false },
    ],
    safety_rules: {
      outbound_default: "blocked",
      preview_recommended: false,
      retry_safe: true,
      retry_requires_approval: false,
    },
  },
];
