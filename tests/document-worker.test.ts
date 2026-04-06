import { beforeEach, describe, expect, it } from "vitest";
import {
  CONTRACT_VERSION,
  JOB_APPROVAL_REQUIREMENT,
  resetJarvisState
} from "@jarvis/shared";
import {
  MockDocumentAdapter,
  createMockDocumentAdapter,
  createDocumentWorker,
  executeDocumentJob,
  isDocumentJobType,
  DOCUMENT_JOB_TYPES,
  DOCUMENT_WORKER_ID,
  DocumentWorkerError,
  MOCK_NOW
} from "@jarvis/document-worker";
import type { JobEnvelope } from "@jarvis/shared";

function makeEnvelope(
  type: string,
  input: Record<string, unknown> = {},
  overrides: Partial<JobEnvelope> = {},
): JobEnvelope {
  return {
    contract_version: CONTRACT_VERSION,
    job_id: `test-${Math.random().toString(36).slice(2)}`,
    type: type as JobEnvelope["type"],
    session_key: "agent:main:api:local:adhoc",
    requested_by: { channel: "api", user_id: "test-user" },
    priority: "normal",
    approval_state: "not_required",
    timeout_seconds: 600,
    attempt: 1,
    input,
    artifacts_in: [],
    retry_policy: { mode: "manual", max_attempts: 3 },
    metadata: {
      agent_id: "main",
      thread_key: null
    },
    ...overrides
  };
}

describe("DOCUMENT_JOB_TYPES", () => {
  it("contains all 5 document job types", () => {
    expect(DOCUMENT_JOB_TYPES).toHaveLength(5);
    expect(DOCUMENT_JOB_TYPES).toContain("document.ingest");
    expect(DOCUMENT_JOB_TYPES).toContain("document.extract_clauses");
    expect(DOCUMENT_JOB_TYPES).toContain("document.analyze_compliance");
    expect(DOCUMENT_JOB_TYPES).toContain("document.compare");
    expect(DOCUMENT_JOB_TYPES).toContain("document.generate_report");
  });
});

describe("DOCUMENT_WORKER_ID", () => {
  it("is 'document-worker'", () => {
    expect(DOCUMENT_WORKER_ID).toBe("document-worker");
  });
});

describe("isDocumentJobType", () => {
  it("returns true for known document job types", () => {
    for (const type of DOCUMENT_JOB_TYPES) {
      expect(isDocumentJobType(type)).toBe(true);
    }
  });

  it("returns false for non-document job types", () => {
    expect(isDocumentJobType("system.monitor_cpu")).toBe(false);
    expect(isDocumentJobType("crm.search")).toBe(false);
    expect(isDocumentJobType("unknown.job")).toBe(false);
    expect(isDocumentJobType("")).toBe(false);
  });
});

describe("MockDocumentAdapter", () => {
  let adapter: MockDocumentAdapter;

  beforeEach(() => {
    adapter = new MockDocumentAdapter();
  });

  describe("ingest", () => {
    it("returns text, sections, and word_count for known file", async () => {
      const result = await adapter.ingest({ file_path: "/tmp/test-nda.pdf", extract_structure: true });
      expect(result.structured_output.text).toBeTruthy();
      expect(result.structured_output.word_count).toBeGreaterThan(0);
      expect(Array.isArray(result.structured_output.sections)).toBe(true);
      expect(result.structured_output.sections.length).toBeGreaterThan(0);
    });

    it("returns the correct file_path in output", async () => {
      const result = await adapter.ingest({ file_path: "/tmp/test-nda.pdf" });
      expect(result.structured_output.file_path).toBe("/tmp/test-nda.pdf");
    });

    it("returns file_type pdf for .pdf extension", async () => {
      const result = await adapter.ingest({ file_path: "/tmp/test-nda.pdf" });
      expect(result.structured_output.file_type).toBe("pdf");
    });

    it("returns file_type docx for .docx extension", async () => {
      const result = await adapter.ingest({ file_path: "/tmp/test-sow.docx" });
      expect(result.structured_output.file_type).toBe("docx");
    });

    it("includes tables when extract_tables is not false", async () => {
      const result = await adapter.ingest({ file_path: "/tmp/test-nda.pdf", extract_tables: true });
      expect(Array.isArray(result.structured_output.tables)).toBe(true);
    });

    it("includes ingested_at timestamp", async () => {
      const result = await adapter.ingest({ file_path: "/tmp/test-nda.pdf" });
      expect(result.structured_output.ingested_at).toBe(MOCK_NOW);
    });

    it("throws DOCUMENT_NOT_FOUND for unknown file paths", async () => {
      await expect(
        adapter.ingest({ file_path: "/nonexistent/totally-unknown-file.pdf" })
      ).rejects.toThrow(DocumentWorkerError);

      try {
        await adapter.ingest({ file_path: "/nonexistent/totally-unknown-file.pdf" });
      } catch (err) {
        expect(err instanceof DocumentWorkerError).toBe(true);
        expect((err as DocumentWorkerError).code).toBe("DOCUMENT_NOT_FOUND");
      }
    });

    it("tracks ingested files in getIngestedFiles()", async () => {
      expect(adapter.getIngestedFiles()).toHaveLength(0);
      await adapter.ingest({ file_path: "/tmp/test-nda.pdf" });
      expect(adapter.getIngestedFiles()).toHaveLength(1);
      await adapter.ingest({ file_path: "/tmp/test-sow.docx" });
      expect(adapter.getIngestedFiles()).toHaveLength(2);
      expect(adapter.getIngestedFiles()).toContain("/tmp/test-nda.pdf");
      expect(adapter.getIngestedFiles()).toContain("/tmp/test-sow.docx");
    });

    it("returns sections with correct structure", async () => {
      const result = await adapter.ingest({ file_path: "/tmp/test-nda.pdf", extract_structure: true });
      const section = result.structured_output.sections[0]!;
      expect(typeof section.content).toBe("string");
    });

    it("returns metadata object", async () => {
      const result = await adapter.ingest({ file_path: "/tmp/test-nda.pdf" });
      expect(result.structured_output.metadata).toBeDefined();
      expect(typeof result.structured_output.metadata).toBe("object");
    });
  });

  describe("extractClauses", () => {
    it("returns clauses with risk_level", async () => {
      const result = await adapter.extractClauses({ file_path: "/tmp/test-nda.pdf", document_type: "nda" });
      expect(result.structured_output.clauses.length).toBeGreaterThan(0);
      for (const clause of result.structured_output.clauses) {
        expect(["low", "medium", "high", "critical"]).toContain(clause.risk_level);
      }
    });

    it("has at least one critical clause", async () => {
      const result = await adapter.extractClauses({ file_path: "/tmp/test-nda.pdf", document_type: "nda" });
      expect(result.structured_output.critical_count).toBeGreaterThan(0);
      const criticals = result.structured_output.clauses.filter((c) => c.risk_level === "critical");
      expect(criticals.length).toBeGreaterThan(0);
    });

    it("has at least two high-risk clauses", async () => {
      const result = await adapter.extractClauses({ document_type: "nda" });
      expect(result.structured_output.high_risk_count).toBeGreaterThanOrEqual(2);
    });

    it("high_risk_count matches actual count", async () => {
      const result = await adapter.extractClauses({ document_type: "nda" });
      const actualHighCount = result.structured_output.clauses.filter((c) => c.risk_level === "high").length;
      expect(result.structured_output.high_risk_count).toBe(actualHighCount);
    });

    it("critical_count matches actual count", async () => {
      const result = await adapter.extractClauses({ document_type: "nda" });
      const actualCriticalCount = result.structured_output.clauses.filter((c) => c.risk_level === "critical").length;
      expect(result.structured_output.critical_count).toBe(actualCriticalCount);
    });

    it("returns extracted_at timestamp", async () => {
      const result = await adapter.extractClauses({ document_type: "nda" });
      expect(result.structured_output.extracted_at).toBe(MOCK_NOW);
    });

    it("clauses have required fields", async () => {
      const result = await adapter.extractClauses({ document_type: "nda" });
      for (const clause of result.structured_output.clauses) {
        expect(clause.clause_id).toBeTruthy();
        expect(clause.category).toBeTruthy();
        expect(clause.title).toBeTruthy();
        expect(clause.text).toBeTruthy();
        expect(Array.isArray(clause.flags)).toBe(true);
      }
    });

    it("has an ip_assignment clause with broad_ip_assignment flag", async () => {
      const result = await adapter.extractClauses({ document_type: "nda" });
      const ipClause = result.structured_output.clauses.find((c) => c.category === "ip_assignment");
      expect(ipClause).toBeDefined();
      expect(ipClause!.flags).toContain("broad_ip_assignment");
    });

    it("tracks extracted documents in getExtractedDocuments()", async () => {
      expect(adapter.getExtractedDocuments()).toHaveLength(0);
      await adapter.extractClauses({ file_path: "/tmp/test-nda.pdf" });
      expect(adapter.getExtractedDocuments()).toHaveLength(1);
    });
  });

  describe("analyzeCompliance", () => {
    it("returns compliance_score between 0 and 100 for iso_26262", async () => {
      const result = await adapter.analyzeCompliance({
        framework: "iso_26262",
        project_asil: "B"
      });
      expect(result.structured_output.compliance_score).toBeGreaterThanOrEqual(0);
      expect(result.structured_output.compliance_score).toBeLessThanOrEqual(100);
    });

    it("compliance_score is less than 100 (not fully compliant)", async () => {
      const result = await adapter.analyzeCompliance({ framework: "iso_26262" });
      expect(result.structured_output.compliance_score).toBeLessThan(100);
    });

    it("has missing requirements (missing_count > 0)", async () => {
      const result = await adapter.analyzeCompliance({ framework: "iso_26262" });
      expect(result.structured_output.missing_count).toBeGreaterThan(0);
    });

    it("critical_gaps is not empty", async () => {
      const result = await adapter.analyzeCompliance({ framework: "iso_26262" });
      expect(result.structured_output.critical_gaps.length).toBeGreaterThan(0);
    });

    it("returns correct framework in output", async () => {
      const result = await adapter.analyzeCompliance({ framework: "iso_26262" });
      expect(result.structured_output.framework).toBe("iso_26262");
    });

    it("items have valid status values", async () => {
      const result = await adapter.analyzeCompliance({ framework: "iso_26262" });
      for (const item of result.structured_output.items) {
        expect(["present", "missing", "partial", "not_applicable"]).toContain(item.status);
      }
    });

    it("present_count + missing_count + partial_count == total_requirements (excluding not_applicable)", async () => {
      const result = await adapter.analyzeCompliance({ framework: "iso_26262" });
      const out = result.structured_output;
      const applicableCount = out.items.filter((i) => i.status !== "not_applicable").length;
      expect(out.present_count + out.missing_count + out.partial_count).toBe(applicableCount);
    });

    it("includes critical gaps mentioning DIA and unit test plan", async () => {
      const result = await adapter.analyzeCompliance({ framework: "iso_26262" });
      const gaps = result.structured_output.critical_gaps.join(" ");
      expect(gaps.toLowerCase()).toContain("dia");
      expect(gaps.toLowerCase()).toContain("unit test");
    });

    it("returns analyzed_at timestamp", async () => {
      const result = await adapter.analyzeCompliance({ framework: "iso_26262" });
      expect(result.structured_output.analyzed_at).toBe(MOCK_NOW);
    });
  });

  describe("compare", () => {
    it("returns changes with correct change_type values", async () => {
      const result = await adapter.compare({
        file_path_a: "/tmp/nda-v1.pdf",
        file_path_b: "/tmp/nda-v2.pdf"
      });
      for (const change of result.structured_output.changes) {
        expect(["added", "removed", "modified"]).toContain(change.change_type);
      }
    });

    it("major_changes count is correct", async () => {
      const result = await adapter.compare({
        file_path_a: "/tmp/nda-v1.pdf",
        file_path_b: "/tmp/nda-v2.pdf"
      });
      const actualMajorCount = result.structured_output.changes.filter(
        (c) => c.significance === "major"
      ).length;
      expect(result.structured_output.major_changes).toBe(actualMajorCount);
    });

    it("has at least 2 major changes", async () => {
      const result = await adapter.compare({
        file_path_a: "/tmp/nda-v1.pdf",
        file_path_b: "/tmp/nda-v2.pdf"
      });
      expect(result.structured_output.major_changes).toBeGreaterThanOrEqual(2);
    });

    it("returns file_a and file_b in output", async () => {
      const result = await adapter.compare({
        file_path_a: "/tmp/nda-v1.pdf",
        file_path_b: "/tmp/nda-v2.pdf"
      });
      expect(result.structured_output.file_a).toBe("/tmp/nda-v1.pdf");
      expect(result.structured_output.file_b).toBe("/tmp/nda-v2.pdf");
    });

    it("similarity_score is between 0 and 1", async () => {
      const result = await adapter.compare({
        file_path_a: "/tmp/nda-v1.pdf",
        file_path_b: "/tmp/nda-v2.pdf"
      });
      expect(result.structured_output.similarity_score).toBeGreaterThanOrEqual(0);
      expect(result.structured_output.similarity_score).toBeLessThanOrEqual(1);
    });

    it("returns compared_at timestamp", async () => {
      const result = await adapter.compare({
        file_path_a: "/tmp/nda-v1.pdf",
        file_path_b: "/tmp/nda-v2.pdf"
      });
      expect(result.structured_output.compared_at).toBe(MOCK_NOW);
    });

    it("changes include IP and jurisdiction modifications (realistic automotive/legal data)", async () => {
      const result = await adapter.compare({
        file_path_a: "/tmp/nda-v1.pdf",
        file_path_b: "/tmp/nda-v2.pdf"
      });
      const descriptions = result.structured_output.changes.map((c) => c.description.toLowerCase());
      const hasIp = descriptions.some((d) => d.includes("ip") || d.includes("intellectual property"));
      const hasJurisdiction = descriptions.some((d) => d.includes("jurisdiction") || d.includes("governing"));
      expect(hasIp).toBe(true);
      expect(hasJurisdiction).toBe(true);
    });
  });

  describe("generateReport", () => {
    it("returns output_path in result", async () => {
      const result = await adapter.generateReport({
        template: "evidence_gap",
        data: {},
        output_format: "docx",
        output_path: "/tmp/report.docx"
      });
      expect(result.structured_output.output_path).toBeTruthy();
      expect(typeof result.structured_output.output_path).toBe("string");
    });

    it("returns generated_at timestamp", async () => {
      const result = await adapter.generateReport({
        template: "evidence_gap",
        data: {},
        output_format: "docx",
        output_path: "/tmp/report.docx"
      });
      expect(result.structured_output.generated_at).toBe(MOCK_NOW);
    });

    it("uses provided title", async () => {
      const result = await adapter.generateReport({
        template: "compliance_summary",
        data: {},
        output_format: "pdf",
        output_path: "/tmp/compliance.pdf",
        title: "My Custom Report Title"
      });
      expect(result.structured_output.title).toBe("My Custom Report Title");
    });

    it("generates default title when not provided", async () => {
      const result = await adapter.generateReport({
        template: "nda_analysis",
        data: {},
        output_format: "markdown",
        output_path: "/tmp/nda-report.md"
      });
      expect(result.structured_output.title).toBeTruthy();
      expect(result.structured_output.title.length).toBeGreaterThan(0);
    });

    it("tracks generated reports in getGeneratedReports()", async () => {
      expect(adapter.getGeneratedReports()).toHaveLength(0);
      await adapter.generateReport({
        template: "evidence_gap",
        data: {},
        output_format: "docx",
        output_path: "/tmp/report1.docx"
      });
      expect(adapter.getGeneratedReports()).toHaveLength(1);
      await adapter.generateReport({
        template: "compliance_summary",
        data: {},
        output_format: "pdf",
        output_path: "/tmp/report2.pdf"
      });
      expect(adapter.getGeneratedReports()).toHaveLength(2);
    });

    it("returns correct template in output", async () => {
      const result = await adapter.generateReport({
        template: "proposal",
        data: {},
        output_format: "docx",
        output_path: "/tmp/proposal.docx"
      });
      expect(result.structured_output.template).toBe("proposal");
    });

    it("section_count is positive", async () => {
      const result = await adapter.generateReport({
        template: "evidence_gap",
        data: {},
        output_format: "docx",
        output_path: "/tmp/gap.docx"
      });
      expect(result.structured_output.section_count).toBeGreaterThan(0);
    });
  });
});

describe("executeDocumentJob", () => {
  let adapter: MockDocumentAdapter;

  beforeEach(() => {
    resetJarvisState();
    adapter = new MockDocumentAdapter();
  });

  it("returns workerId = 'document-worker' by default", async () => {
    const envelope = makeEnvelope("document.ingest", { file_path: "/tmp/test-nda.pdf" });
    const result = await executeDocumentJob(envelope, adapter);
    expect(result.metrics?.worker_id).toBe("document-worker");
  });

  it("document.ingest happy path returns text, sections, word_count", async () => {
    const envelope = makeEnvelope("document.ingest", {
      file_path: "/tmp/test-nda.pdf",
      extract_structure: true
    });
    const result = await executeDocumentJob(envelope, adapter);

    expect(result.status).toBe("completed");
    expect(result.job_type).toBe("document.ingest");
    const out = result.structured_output as Record<string, unknown>;
    expect(typeof out.text).toBe("string");
    expect(Array.isArray(out.sections)).toBe(true);
    expect(typeof out.word_count).toBe("number");
    expect((out.word_count as number)).toBeGreaterThan(0);
  });

  it("document.ingest unknown file returns failed with DOCUMENT_NOT_FOUND", async () => {
    const envelope = makeEnvelope("document.ingest", {
      file_path: "/nonexistent/secret-document.pdf"
    });
    const result = await executeDocumentJob(envelope, adapter);

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("DOCUMENT_NOT_FOUND");
  });

  it("document.extract_clauses returns clauses with risk_level", async () => {
    const envelope = makeEnvelope("document.extract_clauses", {
      document_type: "nda"
    });
    const result = await executeDocumentJob(envelope, adapter);

    expect(result.status).toBe("completed");
    const out = result.structured_output as Record<string, unknown>;
    const clauses = out.clauses as Array<Record<string, unknown>>;
    expect(clauses.length).toBeGreaterThan(0);
    for (const clause of clauses) {
      expect(["low", "medium", "high", "critical"]).toContain(clause.risk_level);
    }
  });

  it("document.extract_clauses critical_count > 0", async () => {
    const envelope = makeEnvelope("document.extract_clauses", { document_type: "nda" });
    const result = await executeDocumentJob(envelope, adapter);

    const out = result.structured_output as Record<string, unknown>;
    expect(out.critical_count as number).toBeGreaterThan(0);
  });

  it("document.extract_clauses high_risk_count is correct", async () => {
    const envelope = makeEnvelope("document.extract_clauses", { document_type: "nda" });
    const result = await executeDocumentJob(envelope, adapter);

    const out = result.structured_output as Record<string, unknown>;
    const clauses = out.clauses as Array<{ risk_level: string }>;
    const expectedHighCount = clauses.filter((c) => c.risk_level === "high").length;
    expect(out.high_risk_count).toBe(expectedHighCount);
  });

  it("document.analyze_compliance iso_26262 compliance_score < 100", async () => {
    const envelope = makeEnvelope("document.analyze_compliance", {
      framework: "iso_26262",
      project_asil: "B"
    });
    const result = await executeDocumentJob(envelope, adapter);

    expect(result.status).toBe("completed");
    const out = result.structured_output as Record<string, unknown>;
    expect(out.compliance_score as number).toBeLessThan(100);
  });

  it("document.analyze_compliance missing_count > 0", async () => {
    const envelope = makeEnvelope("document.analyze_compliance", { framework: "iso_26262" });
    const result = await executeDocumentJob(envelope, adapter);

    const out = result.structured_output as Record<string, unknown>;
    expect(out.missing_count as number).toBeGreaterThan(0);
  });

  it("document.analyze_compliance critical_gaps not empty", async () => {
    const envelope = makeEnvelope("document.analyze_compliance", { framework: "iso_26262" });
    const result = await executeDocumentJob(envelope, adapter);

    const out = result.structured_output as Record<string, unknown>;
    expect((out.critical_gaps as string[]).length).toBeGreaterThan(0);
  });

  it("document.compare changes have correct change_type values", async () => {
    const envelope = makeEnvelope("document.compare", {
      file_path_a: "/tmp/nda-v1.pdf",
      file_path_b: "/tmp/nda-v2.pdf"
    });
    const result = await executeDocumentJob(envelope, adapter);

    expect(result.status).toBe("completed");
    const out = result.structured_output as Record<string, unknown>;
    const changes = out.changes as Array<{ change_type: string }>;
    for (const change of changes) {
      expect(["added", "removed", "modified"]).toContain(change.change_type);
    }
  });

  it("document.compare major_changes count is correct", async () => {
    const envelope = makeEnvelope("document.compare", {
      file_path_a: "/tmp/nda-v1.pdf",
      file_path_b: "/tmp/nda-v2.pdf"
    });
    const result = await executeDocumentJob(envelope, adapter);

    const out = result.structured_output as Record<string, unknown>;
    const changes = out.changes as Array<{ significance: string }>;
    const actualMajor = changes.filter((c) => c.significance === "major").length;
    expect(out.major_changes).toBe(actualMajor);
  });

  it("document.generate_report returns output_path", async () => {
    const envelope = makeEnvelope("document.generate_report", {
      template: "evidence_gap",
      data: { project: "EBCS" },
      output_format: "docx",
      output_path: "/tmp/evidence-gap.docx",
      title: "Evidence Gap Report"
    });
    const result = await executeDocumentJob(envelope, adapter);

    expect(result.status).toBe("completed");
    const out = result.structured_output as Record<string, unknown>;
    expect(typeof out.output_path).toBe("string");
    expect((out.output_path as string).length).toBeGreaterThan(0);
  });

  it("document.generate_report result has generated_at", async () => {
    const envelope = makeEnvelope("document.generate_report", {
      template: "compliance_summary",
      data: {},
      output_format: "pdf",
      output_path: "/tmp/compliance.pdf"
    });
    const result = await executeDocumentJob(envelope, adapter);

    const out = result.structured_output as Record<string, unknown>;
    expect(out.generated_at).toBe(MOCK_NOW);
  });

  it("document.generate_report requires conditional approval per JOB_APPROVAL_REQUIREMENT", () => {
    expect(JOB_APPROVAL_REQUIREMENT["document.generate_report"]).toBe("conditional");
  });

  it("document.ingest requires no approval", () => {
    expect(JOB_APPROVAL_REQUIREMENT["document.ingest"]).toBe("not_required");
  });

  it("document.extract_clauses requires no approval", () => {
    expect(JOB_APPROVAL_REQUIREMENT["document.extract_clauses"]).toBe("not_required");
  });

  it("document.analyze_compliance requires no approval", () => {
    expect(JOB_APPROVAL_REQUIREMENT["document.analyze_compliance"]).toBe("not_required");
  });

  it("document.compare requires no approval", () => {
    expect(JOB_APPROVAL_REQUIREMENT["document.compare"]).toBe("not_required");
  });

  it("DOCUMENT_NOT_FOUND error propagates to failed result", async () => {
    const envelope = makeEnvelope("document.ingest", {
      file_path: "/totally/unknown/file.pdf"
    });
    const result = await executeDocumentJob(envelope, adapter);

    expect(result.status).toBe("failed");
    expect(result.error).toBeDefined();
    expect(result.error!.code).toBe("DOCUMENT_NOT_FOUND");
    expect(result.error!.retryable).toBe(false);
  });

  it("DocumentWorkerError maps to failed result with correct code", async () => {
    const faultyAdapter = new MockDocumentAdapter();
    faultyAdapter.ingest = async (_input) => {
      throw new DocumentWorkerError("PARSE_ERROR", "Failed to parse PDF structure.", false);
    };

    const envelope = makeEnvelope("document.ingest", { file_path: "/tmp/test-nda.pdf" });
    const result = await executeDocumentJob(envelope, faultyAdapter);

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("PARSE_ERROR");
    expect(result.error?.message).toContain("Failed to parse PDF structure.");
    expect(result.error?.retryable).toBe(false);
  });

  it("compliance_score is in 0-100 range", async () => {
    const envelope = makeEnvelope("document.analyze_compliance", {
      framework: "iso_26262",
      project_asil: "D"
    });
    const result = await executeDocumentJob(envelope, adapter);

    const out = result.structured_output as Record<string, unknown>;
    const score = out.compliance_score as number;
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("returns failed for unsupported job type", async () => {
    const envelope = makeEnvelope("system.monitor_cpu", {});
    const result = await executeDocumentJob(envelope, adapter);

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("INVALID_INPUT");
  });

  it("wraps generic Error as INTERNAL_ERROR", async () => {
    const faultyAdapter = new MockDocumentAdapter();
    faultyAdapter.compare = async (_input) => {
      throw new Error("Unexpected internal failure");
    };

    const envelope = makeEnvelope("document.compare", {
      file_path_a: "/tmp/nda-v1.pdf",
      file_path_b: "/tmp/nda-v2.pdf"
    });
    const result = await executeDocumentJob(envelope, faultyAdapter);

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("INTERNAL_ERROR");
    expect(result.error?.message).toBe("Unexpected internal failure");
  });

  it("uses custom workerId when provided", async () => {
    const envelope = makeEnvelope("document.analyze_compliance", { framework: "iso_26262" });
    const result = await executeDocumentJob(envelope, adapter, { workerId: "custom-document-worker" });

    expect(result.metrics?.worker_id).toBe("custom-document-worker");
  });
});

describe("createDocumentWorker", () => {
  beforeEach(() => {
    resetJarvisState();
  });

  it("exposes a default workerId of 'document-worker'", () => {
    const worker = createDocumentWorker({ adapter: createMockDocumentAdapter() });
    expect(worker.workerId).toBe("document-worker");
  });

  it("uses provided workerId", () => {
    const worker = createDocumentWorker({
      adapter: createMockDocumentAdapter(),
      workerId: "my-document-worker"
    });
    expect(worker.workerId).toBe("my-document-worker");
  });

  it("executes document.ingest via the worker facade", async () => {
    const worker = createDocumentWorker({ adapter: createMockDocumentAdapter() });
    const envelope = makeEnvelope("document.ingest", { file_path: "/tmp/test-nda.pdf" });
    const result = await worker.execute(envelope);

    expect(result.status).toBe("completed");
    expect(result.metrics?.worker_id).toBe("document-worker");
    const out = result.structured_output as Record<string, unknown>;
    expect(typeof out.word_count).toBe("number");
  });
});
