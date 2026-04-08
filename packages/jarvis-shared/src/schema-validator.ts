/**
 * Lightweight runtime validation for job input payloads.
 *
 * Build-time validation runs the full JSON-Schema suite via
 * `scripts/validate-contracts.mjs`. This module provides a "best-effort"
 * structural check that workers can call before routing, catching the
 * most common malformed payloads (missing required fields, wrong field
 * types) without pulling in AJV at runtime.
 *
 * Job types that do not appear in the registry pass through unchecked —
 * not all types have schemas yet.
 */

import type { JarvisJobType } from "./contracts.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type ValidationResult = {
  valid: boolean;
  errors: string[];
};

/**
 * Validate a job input payload against the known structural rules for
 * `jobType`. Returns `{ valid: true, errors: [] }` when the input passes
 * or when no schema is registered for the job type (pass-through).
 */
export function validateJobInput(
  jobType: JarvisJobType,
  input: unknown,
): ValidationResult {
  const spec = JOB_INPUT_SCHEMAS[jobType];
  if (!spec) {
    // No schema registered — pass through.
    return { valid: true, errors: [] };
  }

  const errors: string[] = [];

  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { valid: false, errors: ["input must be a non-null object"] };
  }

  const record = input as Record<string, unknown>;

  // Required fields --------------------------------------------------------
  for (const field of spec.required) {
    if (!(field in record) || record[field] === undefined) {
      errors.push(`missing required field "${field}"`);
    }
  }

  // Type checks ------------------------------------------------------------
  if (spec.fields) {
    for (const [field, expectedType] of Object.entries(spec.fields)) {
      if (!(field in record) || record[field] === undefined) {
        continue; // already flagged by required check or is optional
      }

      const value = record[field];
      const typeError = checkFieldType(field, value, expectedType);
      if (typeError) {
        errors.push(typeError);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type FieldType =
  | "string"
  | "number"
  | "boolean"
  | "object"
  | "array"
  | "string[]"
  | "integer";

function checkFieldType(
  field: string,
  value: unknown,
  expected: FieldType,
): string | null {
  switch (expected) {
    case "string":
      return typeof value === "string"
        ? null
        : `field "${field}" must be a string, got ${typeof value}`;

    case "number":
      return typeof value === "number"
        ? null
        : `field "${field}" must be a number, got ${typeof value}`;

    case "integer":
      return typeof value === "number" && Number.isInteger(value)
        ? null
        : `field "${field}" must be an integer, got ${typeof value === "number" ? "non-integer number" : typeof value}`;

    case "boolean":
      return typeof value === "boolean"
        ? null
        : `field "${field}" must be a boolean, got ${typeof value}`;

    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value)
        ? null
        : `field "${field}" must be an object, got ${Array.isArray(value) ? "array" : typeof value}`;

    case "array":
      return Array.isArray(value)
        ? null
        : `field "${field}" must be an array, got ${typeof value}`;

    case "string[]":
      if (!Array.isArray(value)) {
        return `field "${field}" must be an array of strings, got ${typeof value}`;
      }
      for (let i = 0; i < value.length; i++) {
        if (typeof value[i] !== "string") {
          return `field "${field}[${i}]" must be a string, got ${typeof value[i]}`;
        }
      }
      return null;

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Schema registry — covers the ~55 most common job types.
//
// Each entry declares the required fields and (optionally) the expected
// types for all known fields. Types are checked only when the field is
// present, so optional fields are safe to omit.
//
// Derived from contracts/jarvis/v1/*-job-types.schema.json.
// ---------------------------------------------------------------------------

type InputSpec = {
  required: string[];
  fields?: Record<string, FieldType>;
};

const JOB_INPUT_SCHEMAS: Partial<Record<JarvisJobType, InputSpec>> = {
  // -- Files ---------------------------------------------------------------
  "files.inspect": {
    required: ["paths"],
    fields: { paths: "string[]", root_path: "string", recursive: "boolean", include_stats: "boolean", preview_lines: "integer" }
  },
  "files.read": {
    required: ["path"],
    fields: { path: "string", root_path: "string", encoding: "string" }
  },
  "files.search": {
    required: ["query"],
    fields: { query: "string", root_path: "string", case_sensitive: "boolean", include_contents: "boolean" }
  },
  "files.write": {
    required: ["path", "content"],
    fields: { path: "string", content: "string", root_path: "string", encoding: "string", create_dirs: "boolean" }
  },
  "files.patch": {
    required: ["path", "operations"],
    fields: { path: "string", operations: "array", root_path: "string" }
  },
  "files.copy": {
    required: ["source_path", "destination_path"],
    fields: { source_path: "string", destination_path: "string", root_path: "string", overwrite: "boolean" }
  },
  "files.move": {
    required: ["source_path", "destination_path"],
    fields: { source_path: "string", destination_path: "string", root_path: "string", overwrite: "boolean" }
  },
  "files.preview": {
    required: ["path"],
    fields: { path: "string", root_path: "string" }
  },

  // -- Office --------------------------------------------------------------
  "office.inspect": {
    required: ["target_artifacts"],
    fields: { target_artifacts: "array" }
  },
  "office.merge_excel": {
    required: ["files", "mode", "sheet_policy", "output_name"],
    fields: { files: "array", mode: "string", sheet_policy: "string", output_name: "string", sheet_name: "string" }
  },
  "office.transform_excel": {
    required: ["source_artifact", "output_name"],
    fields: { source_artifact: "object", output_name: "string", sheet_mode: "string", sheet_name: "string", select_columns: "string[]" }
  },
  "office.fill_docx": {
    required: ["template_artifact_id", "variables", "output_name"],
    fields: { template_artifact_id: "string", variables: "object", output_name: "string", strict_variables: "boolean" }
  },
  "office.build_pptx": {
    required: ["source", "theme", "output_name"],
    fields: { source: "object", theme: "string", output_name: "string" }
  },
  "office.extract_tables": {
    required: ["source_artifact", "format", "output_name"],
    fields: { source_artifact: "object", format: "string", output_name: "string" }
  },
  "office.preview": {
    required: ["source_artifact", "format", "output_name"],
    fields: { source_artifact: "object", format: "string", output_name: "string" }
  },

  // -- Browser -------------------------------------------------------------
  "browser.run_task": {
    required: ["task"],
    fields: { task: "string", start_url: "string", allowed_domains: "string[]", capture_evidence: "boolean", max_steps: "integer", output_name: "string" }
  },
  "browser.extract": {
    required: ["targets", "extraction_mode"],
    fields: { targets: "string[]", extraction_mode: "string", selectors: "string[]", follow_pagination: "boolean", max_pages: "integer", output_name: "string" }
  },
  "browser.capture": {
    required: ["target_url", "mode", "output_name"],
    fields: { target_url: "string", mode: "string", full_page: "boolean", output_name: "string" }
  },
  "browser.download": {
    required: ["source_url"],
    fields: { source_url: "string", expected_kind: "string", output_name: "string" }
  },
  "browser.navigate": {
    required: ["url"],
    fields: { url: "string" }
  },
  "browser.click": {
    required: ["selector"],
    fields: { selector: "string" }
  },
  "browser.type": {
    required: ["selector", "text"],
    fields: { selector: "string", text: "string" }
  },
  "browser.evaluate": {
    required: ["script"],
    fields: { script: "string", args: "array" }
  },
  "browser.wait_for": {
    required: ["selector"],
    fields: { selector: "string", timeout_ms: "integer" }
  },

  // -- Search & Scrape -----------------------------------------------------
  "search.query": {
    required: ["query"],
    fields: { query: "string", freshness: "string", max_results: "integer" }
  },
  "search.fetch": {
    required: ["url"],
    fields: { url: "string", output_name: "string" }
  },
  "scrape.extract": {
    required: ["url"],
    fields: { url: "string", selectors: "string[]", output_name: "string" }
  },
  "scrape.crawl": {
    required: ["start_url"],
    fields: { start_url: "string", max_pages: "integer", allowed_domains: "string[]" }
  },

  // -- Email ---------------------------------------------------------------
  "email.search": {
    required: ["query"],
    fields: { query: "string", max_results: "integer", page_token: "string" }
  },
  "email.read": {
    required: ["message_id"],
    fields: { message_id: "string", include_raw: "boolean" }
  },
  "email.draft": {
    required: ["to", "subject", "body"],
    fields: { to: "string[]", subject: "string", body: "string", cc: "string[]", reply_to_message_id: "string" }
  },
  "email.send": {
    required: [],
    fields: { draft_id: "string", to: "string[]", subject: "string", body: "string", cc: "string[]", reply_to_message_id: "string" }
  },
  "email.label": {
    required: ["message_id", "action", "labels"],
    fields: { message_id: "string", action: "string", labels: "string[]" }
  },
  "email.list_threads": {
    required: [],
    fields: { query: "string", max_results: "integer" }
  },

  // -- CRM -----------------------------------------------------------------
  "crm.add_contact": {
    required: ["name", "company"],
    fields: { name: "string", company: "string", role: "string", email: "string", linkedin_url: "string", source: "string", tags: "string[]", notes: "string", stage: "string" }
  },
  "crm.update_contact": {
    required: ["contact_id"],
    fields: { contact_id: "string", name: "string", company: "string", role: "string", email: "string", tags: "string[]", score: "integer" }
  },
  "crm.list_pipeline": {
    required: [],
    fields: { stage: "string", tags: "string[]", min_score: "integer", limit: "integer" }
  },
  "crm.move_stage": {
    required: ["contact_id", "new_stage"],
    fields: { contact_id: "string", new_stage: "string", reason: "string" }
  },
  "crm.add_note": {
    required: ["contact_id", "content"],
    fields: { contact_id: "string", content: "string", note_type: "string" }
  },
  "crm.search": {
    required: ["query"],
    fields: { query: "string", fields: "string[]", stage: "string" }
  },
  "crm.digest": {
    required: [],
    fields: { include_parked: "boolean", days_since_contact: "integer" }
  },

  // -- Calendar ------------------------------------------------------------
  "calendar.list_events": {
    required: ["start_date", "end_date"],
    fields: { start_date: "string", end_date: "string", calendar_id: "string" }
  },
  "calendar.create_event": {
    required: ["title", "start", "end"],
    fields: { title: "string", start: "string", end: "string", description: "string", location: "string", attendees: "array", calendar_id: "string" }
  },
  "calendar.update_event": {
    required: ["event_id"],
    fields: { event_id: "string", title: "string", start: "string", end: "string", description: "string", location: "string", attendees: "array", calendar_id: "string" }
  },
  "calendar.find_free": {
    required: ["attendees", "duration_minutes", "start_search", "end_search"],
    fields: { attendees: "string[]", duration_minutes: "integer", start_search: "string", end_search: "string", calendar_id: "string" }
  },
  "calendar.brief": {
    required: ["event_id"],
    fields: { event_id: "string", calendar_id: "string", include_history: "boolean" }
  },

  // -- Web Intelligence ----------------------------------------------------
  "web.search_news": {
    required: ["query"],
    fields: { query: "string", max_results: "integer", date_from: "string", sources: "string[]" }
  },
  "web.scrape_profile": {
    required: ["url", "profile_type"],
    fields: { url: "string", profile_type: "string", extract_fields: "string[]" }
  },
  "web.monitor_page": {
    required: ["url", "page_id"],
    fields: { url: "string", page_id: "string", selector: "string" }
  },
  "web.enrich_contact": {
    required: ["name"],
    fields: { name: "string", company: "string", email: "string", linkedin_url: "string" }
  },
  "web.track_jobs": {
    required: ["company_names", "keywords"],
    fields: { company_names: "string[]", keywords: "string[]", max_per_company: "integer" }
  },
  "web.competitive_intel": {
    required: ["company_name"],
    fields: { company_name: "string", aspects: "string[]" }
  },

  // -- Document ------------------------------------------------------------
  "document.ingest": {
    required: ["file_path"],
    fields: { file_path: "string", extract_structure: "boolean", extract_tables: "boolean", max_pages: "integer" }
  },
  "document.extract_clauses": {
    required: [],
    fields: { file_path: "string", text: "string", document_type: "string" }
  },
  "document.analyze_compliance": {
    required: ["framework"],
    fields: { framework: "string", file_path: "string", text: "string" }
  },
  "document.compare": {
    required: ["file_path_a", "file_path_b"],
    fields: { file_path_a: "string", file_path_b: "string" }
  },
  "document.generate_report": {
    required: ["template", "data", "output_format", "output_path"],
    fields: { template: "string", data: "object", output_format: "string", output_path: "string" }
  },

  // -- Inference -----------------------------------------------------------
  "inference.chat": {
    required: ["messages"],
    fields: { messages: "array", model: "string", temperature: "number", max_tokens: "integer" }
  },
  "inference.vision_chat": {
    required: ["messages"],
    fields: { messages: "array", model: "string", temperature: "number", max_tokens: "integer" }
  },
  "inference.embed": {
    required: ["texts"],
    fields: { texts: "string[]", model: "string" }
  },
  "inference.list_models": {
    required: [],
    fields: { runtime: "string" }
  },
  "inference.rag_index": {
    required: ["paths", "collection"],
    fields: { paths: "string[]", collection: "string" }
  },
  "inference.rag_query": {
    required: ["query", "collection", "top_k"],
    fields: { query: "string", collection: "string", top_k: "integer" }
  },
  "inference.batch_submit": {
    required: ["jobs"],
    fields: { jobs: "array" }
  },
  "inference.batch_status": {
    required: ["batch_id"],
    fields: { batch_id: "string" }
  },

  // -- Agent ---------------------------------------------------------------
  "agent.start": {
    required: ["agent_id", "trigger_kind"],
    fields: { agent_id: "string", trigger_kind: "string", goal: "string", cron: "string", event_type: "string", alert_id: "string" }
  },
  "agent.step": {
    required: ["run_id", "action"],
    fields: { run_id: "string", action: "string", input: "object" }
  },
  "agent.status": {
    required: ["run_id"],
    fields: { run_id: "string" }
  },
  "agent.pause": {
    required: ["run_id"],
    fields: { run_id: "string", reason: "string" }
  },
  "agent.resume": {
    required: ["run_id"],
    fields: { run_id: "string" }
  },
  "agent.configure": {
    required: ["agent_id"],
    fields: { agent_id: "string" }
  },
};
