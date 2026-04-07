/**
 * Exhaustive Stress: Document Worker
 *
 * Covers every document operation type with thorough input permutations:
 * ingest, extract_clauses, analyze_compliance, compare, generate_report,
 * inspection helpers, concurrency, and full pipelines.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MockDocumentAdapter, executeDocumentJob } from "@jarvis/document-worker";
import type { JobEnvelope } from "@jarvis/shared";
import { range } from "./helpers.js";

function envelope(type: string, input: Record<string, unknown>): JobEnvelope {
  return {
    contract_version: "1.0.0",
    job_id: randomUUID(),
    type: type as any,
    input,
    attempt: 1,
    metadata: { agent_id: "test", run_id: randomUUID() },
  };
}

// ── Ingest ──────────────────────────────────────────────────────────────────

describe("Document Exhaustive — ingest", () => {
  let doc: MockDocumentAdapter;

  beforeEach(() => {
    doc = new MockDocumentAdapter();
  });

  it("basic ingest with file_path only", async () => {
    const result = await executeDocumentJob(
      envelope("document.ingest", { file_path: "/tmp/test-contract-alpha.pdf" }),
      doc,
    );
    expect(result.status).toBe("completed");
    expect(doc.getIngestedFiles()).toContain("/tmp/test-contract-alpha.pdf");
  });

  it("ingest with extract_structure=true", async () => {
    const result = await executeDocumentJob(
      envelope("document.ingest", { file_path: "/tmp/test-nda.pdf", extract_structure: true }),
      doc,
    );
    expect(result.status).toBe("completed");
    expect(doc.getIngestedFiles()).toContain("/tmp/test-nda.pdf");
  });

  it("ingest with extract_tables=true", async () => {
    const result = await executeDocumentJob(
      envelope("document.ingest", { file_path: "/tmp/test-sow.pdf", extract_tables: true }),
      doc,
    );
    expect(result.status).toBe("completed");
  });

  it("ingest with max_pages limit", async () => {
    const result = await executeDocumentJob(
      envelope("document.ingest", { file_path: "/tmp/test-large-spec.pdf", max_pages: 10 }),
      doc,
    );
    expect(result.status).toBe("completed");
  });

  it("ingest with all options combined", async () => {
    const result = await executeDocumentJob(
      envelope("document.ingest", {
        file_path: "/tmp/test-full-spec.pdf",
        extract_structure: true,
        extract_tables: true,
        max_pages: 50,
      }),
      doc,
    );
    expect(result.status).toBe("completed");
  });

  it("ingest multiple files tracked independently", async () => {
    await executeDocumentJob(envelope("document.ingest", { file_path: "/tmp/test-file-a.pdf" }), doc);
    await executeDocumentJob(envelope("document.ingest", { file_path: "/tmp/test-file-b.pdf" }), doc);
    await executeDocumentJob(envelope("document.ingest", { file_path: "/tmp/test-file-c.pdf" }), doc);
    const files = doc.getIngestedFiles();
    expect(files).toContain("/tmp/test-file-a.pdf");
    expect(files).toContain("/tmp/test-file-b.pdf");
    expect(files).toContain("/tmp/test-file-c.pdf");
    expect(files).toHaveLength(3);
  });
});

// ── Extract Clauses ─────────────────────────────────────────────────────────

describe("Document Exhaustive — extract_clauses", () => {
  let doc: MockDocumentAdapter;

  beforeEach(() => {
    doc = new MockDocumentAdapter();
  });

  it("extract by file_path", async () => {
    const result = await executeDocumentJob(
      envelope("document.extract_clauses", { file_path: "/contracts/nda-bertrandt.pdf" }),
      doc,
    );
    expect(result.status).toBe("completed");
  });

  it("extract by text content", async () => {
    const result = await executeDocumentJob(
      envelope("document.extract_clauses", {
        text: "This agreement shall remain confidential for a period of five years from the date of execution.",
      }),
      doc,
    );
    expect(result.status).toBe("completed");
  });

  it("extract with document_type=nda", async () => {
    const result = await executeDocumentJob(
      envelope("document.extract_clauses", { file_path: "/contracts/nda.pdf", document_type: "nda" }),
      doc,
    );
    expect(result.status).toBe("completed");
    expect(doc.getExtractedDocuments().length).toBeGreaterThan(0);
  });

  it("extract with document_type=msa", async () => {
    const result = await executeDocumentJob(
      envelope("document.extract_clauses", { file_path: "/contracts/msa.pdf", document_type: "msa" }),
      doc,
    );
    expect(result.status).toBe("completed");
  });

  it("extract with document_type=sow", async () => {
    const result = await executeDocumentJob(
      envelope("document.extract_clauses", { file_path: "/contracts/sow.pdf", document_type: "sow" }),
      doc,
    );
    expect(result.status).toBe("completed");
  });

  it("extract with document_type=contract", async () => {
    const result = await executeDocumentJob(
      envelope("document.extract_clauses", { file_path: "/contracts/general.pdf", document_type: "contract" }),
      doc,
    );
    expect(result.status).toBe("completed");
  });

  it("extract with document_type=agreement", async () => {
    const result = await executeDocumentJob(
      envelope("document.extract_clauses", { file_path: "/contracts/partnership.pdf", document_type: "agreement" }),
      doc,
    );
    expect(result.status).toBe("completed");
  });
});

// ── Analyze Compliance ──────────────────────────────────────────────────────

describe("Document Exhaustive — analyze_compliance", () => {
  let doc: MockDocumentAdapter;

  beforeEach(() => {
    doc = new MockDocumentAdapter();
  });

  it("analyze with framework=iso_26262", async () => {
    const result = await executeDocumentJob(
      envelope("document.analyze_compliance", { file_path: "/docs/safety-plan.pdf", framework: "iso_26262" }),
      doc,
    );
    expect(result.status).toBe("completed");
  });

  it("analyze with framework=aspice", async () => {
    const result = await executeDocumentJob(
      envelope("document.analyze_compliance", { file_path: "/docs/process-doc.pdf", framework: "aspice" }),
      doc,
    );
    expect(result.status).toBe("completed");
  });

  it("analyze with framework=autosar", async () => {
    const result = await executeDocumentJob(
      envelope("document.analyze_compliance", { file_path: "/docs/autosar-spec.pdf", framework: "autosar" }),
      doc,
    );
    expect(result.status).toBe("completed");
  });

  it("analyze with framework=iso_21434", async () => {
    const result = await executeDocumentJob(
      envelope("document.analyze_compliance", { file_path: "/docs/cybersecurity.pdf", framework: "iso_21434" }),
      doc,
    );
    expect(result.status).toBe("completed");
  });

  it("analyze with project_asil=A", async () => {
    const result = await executeDocumentJob(
      envelope("document.analyze_compliance", { file_path: "/docs/asil-a.pdf", framework: "iso_26262", project_asil: "A" }),
      doc,
    );
    expect(result.status).toBe("completed");
  });

  it("analyze with project_asil=B", async () => {
    const result = await executeDocumentJob(
      envelope("document.analyze_compliance", { file_path: "/docs/asil-b.pdf", framework: "iso_26262", project_asil: "B" }),
      doc,
    );
    expect(result.status).toBe("completed");
  });

  it("analyze with project_asil=C", async () => {
    const result = await executeDocumentJob(
      envelope("document.analyze_compliance", { file_path: "/docs/asil-c.pdf", framework: "iso_26262", project_asil: "C" }),
      doc,
    );
    expect(result.status).toBe("completed");
  });

  it("analyze with project_asil=D", async () => {
    const result = await executeDocumentJob(
      envelope("document.analyze_compliance", { file_path: "/docs/asil-d.pdf", framework: "iso_26262", project_asil: "D" }),
      doc,
    );
    expect(result.status).toBe("completed");
  });

  it("analyze with work_product_type", async () => {
    const result = await executeDocumentJob(
      envelope("document.analyze_compliance", {
        file_path: "/docs/test-spec.pdf",
        framework: "iso_26262",
        project_asil: "C",
        work_product_type: "software_unit_test_spec",
      }),
      doc,
    );
    expect(result.status).toBe("completed");
  });

  it("analyze by text instead of file_path", async () => {
    const result = await executeDocumentJob(
      envelope("document.analyze_compliance", {
        text: "The safety plan defines ASIL D requirements for the braking control module...",
        framework: "iso_26262",
      }),
      doc,
    );
    expect(result.status).toBe("completed");
  });
});

// ── Compare ─────────────────────────────────────────────────────────────────

describe("Document Exhaustive — compare", () => {
  let doc: MockDocumentAdapter;

  beforeEach(() => {
    doc = new MockDocumentAdapter();
  });

  it("compare two different files", async () => {
    const result = await executeDocumentJob(
      envelope("document.compare", {
        file_path_a: "/contracts/nda-v1.pdf",
        file_path_b: "/contracts/nda-v2.pdf",
      }),
      doc,
    );
    expect(result.status).toBe("completed");
  });

  it("compare same file with itself", async () => {
    const result = await executeDocumentJob(
      envelope("document.compare", {
        file_path_a: "/contracts/msa.pdf",
        file_path_b: "/contracts/msa.pdf",
      }),
      doc,
    );
    expect(result.status).toBe("completed");
  });
});

// ── Generate Report ─────────────────────────────────────────────────────────

describe("Document Exhaustive — generate_report", () => {
  let doc: MockDocumentAdapter;

  beforeEach(() => {
    doc = new MockDocumentAdapter();
  });

  it("generate proposal template as docx", async () => {
    const result = await executeDocumentJob(
      envelope("document.generate_report", {
        template: "proposal",
        data: { client: "Bertrandt AG", scope: "ISO 26262 gap analysis" },
        output_format: "docx",
        output_path: "/output/proposal-bertrandt",
        title: "Bertrandt ISO 26262 Proposal",
      }),
      doc,
    );
    expect(result.status).toBe("completed");
    expect(doc.getGeneratedReports().length).toBeGreaterThan(0);
  });

  it("generate evidence_gap template as pdf", async () => {
    const result = await executeDocumentJob(
      envelope("document.generate_report", {
        template: "evidence_gap",
        data: { project: "ECU Braking Module", gaps: 5 },
        output_format: "pdf",
        output_path: "/output/gap-report",
        title: "Evidence Gap Matrix",
      }),
      doc,
    );
    expect(result.status).toBe("completed");
  });

  it("generate compliance_summary template as markdown", async () => {
    const result = await executeDocumentJob(
      envelope("document.generate_report", {
        template: "compliance_summary",
        data: { framework: "ASPICE", score: 92 },
        output_format: "markdown",
        output_path: "/output/compliance-summary",
      }),
      doc,
    );
    expect(result.status).toBe("completed");
  });

  it("generate nda_analysis template as pdf", async () => {
    const result = await executeDocumentJob(
      envelope("document.generate_report", {
        template: "nda_analysis",
        data: { clauses: 12, issues: 3 },
        output_format: "pdf",
        output_path: "/output/nda-analysis",
        title: "NDA Analysis: EDAG",
      }),
      doc,
    );
    expect(result.status).toBe("completed");
  });

  it("generate custom template as docx", async () => {
    const result = await executeDocumentJob(
      envelope("document.generate_report", {
        template: "custom",
        data: { content: "Custom report body" },
        output_format: "docx",
        output_path: "/output/custom-report",
        title: "Custom Report",
      }),
      doc,
    );
    expect(result.status).toBe("completed");
  });

  it("generate report without title", async () => {
    const result = await executeDocumentJob(
      envelope("document.generate_report", {
        template: "proposal",
        data: { client: "Continental" },
        output_format: "pdf",
        output_path: "/output/no-title-report",
      }),
      doc,
    );
    expect(result.status).toBe("completed");
  });

  it("every output_format: docx", async () => {
    const result = await executeDocumentJob(
      envelope("document.generate_report", {
        template: "custom",
        data: {},
        output_format: "docx",
        output_path: "/output/fmt-docx",
      }),
      doc,
    );
    expect(result.status).toBe("completed");
  });

  it("every output_format: pdf", async () => {
    const result = await executeDocumentJob(
      envelope("document.generate_report", {
        template: "custom",
        data: {},
        output_format: "pdf",
        output_path: "/output/fmt-pdf",
      }),
      doc,
    );
    expect(result.status).toBe("completed");
  });

  it("every output_format: markdown", async () => {
    const result = await executeDocumentJob(
      envelope("document.generate_report", {
        template: "custom",
        data: {},
        output_format: "markdown",
        output_path: "/output/fmt-md",
      }),
      doc,
    );
    expect(result.status).toBe("completed");
  });
});

// ── Full pipeline ───────────────────────────────────────────────────────────

describe("Document Exhaustive — full pipeline", () => {
  let doc: MockDocumentAdapter;

  beforeEach(() => {
    doc = new MockDocumentAdapter();
  });

  it("ingest -> extract -> analyze -> report", async () => {
    // Step 1 — Ingest
    const ingest = await executeDocumentJob(
      envelope("document.ingest", { file_path: "/tmp/test-safety-case.pdf", extract_structure: true }),
      doc,
    );
    expect(ingest.status).toBe("completed");
    expect(doc.getIngestedFiles()).toContain("/tmp/test-safety-case.pdf");

    // Step 2 — Extract clauses
    const extract = await executeDocumentJob(
      envelope("document.extract_clauses", { file_path: "/tmp/test-safety-case.pdf", document_type: "contract" }),
      doc,
    );
    expect(extract.status).toBe("completed");

    // Step 3 — Analyze compliance
    const analyze = await executeDocumentJob(
      envelope("document.analyze_compliance", { file_path: "/tmp/test-safety-case.pdf", framework: "iso_26262", project_asil: "D" }),
      doc,
    );
    expect(analyze.status).toBe("completed");

    // Step 4 — Generate report
    const report = await executeDocumentJob(
      envelope("document.generate_report", {
        template: "compliance_summary",
        data: { compliance_score: 78, critical_gaps: 4 },
        output_format: "pdf",
        output_path: "/output/safety-case-report",
        title: "Safety Case Compliance Summary",
      }),
      doc,
    );
    expect(report.status).toBe("completed");
    expect(doc.getGeneratedReports().length).toBe(1);
  });
});

// ── Concurrency ─────────────────────────────────────────────────────────────

describe("Document Exhaustive — concurrency", () => {
  let doc: MockDocumentAdapter;

  beforeEach(() => {
    doc = new MockDocumentAdapter();
  });

  it("20 parallel document operations", async () => {
    const ops = [
      ...range(5).map(i =>
        executeDocumentJob(envelope("document.ingest", { file_path: `/tmp/test-parallel-${i}.pdf` }), doc),
      ),
      ...range(4).map(i =>
        executeDocumentJob(envelope("document.extract_clauses", { file_path: `/contracts/clause-${i}.pdf`, document_type: "nda" }), doc),
      ),
      ...range(4).map(i =>
        executeDocumentJob(envelope("document.analyze_compliance", { file_path: `/docs/comp-${i}.pdf`, framework: "iso_26262" }), doc),
      ),
      ...range(3).map(i =>
        executeDocumentJob(envelope("document.compare", { file_path_a: `/docs/a-${i}.pdf`, file_path_b: `/docs/b-${i}.pdf` }), doc),
      ),
      ...range(4).map(i =>
        executeDocumentJob(envelope("document.generate_report", {
          template: "custom",
          data: { index: i },
          output_format: "pdf",
          output_path: `/output/concurrent-${i}`,
        }), doc),
      ),
    ];
    const results = await Promise.all(ops);
    expect(results).toHaveLength(20);
    expect(results.every(r => r.status === "completed")).toBe(true);
    expect(doc.getIngestedFiles()).toHaveLength(5);
    expect(doc.getGeneratedReports()).toHaveLength(4);
  });
});

// ── Inspection helpers ──────────────────────────────────────────────────────

describe("Document Exhaustive — inspection helpers", () => {
  let doc: MockDocumentAdapter;

  beforeEach(() => {
    doc = new MockDocumentAdapter();
  });

  it("getIngestedFiles starts empty", () => {
    expect(doc.getIngestedFiles()).toHaveLength(0);
  });

  it("getGeneratedReports starts empty", () => {
    expect(doc.getGeneratedReports()).toHaveLength(0);
  });

  it("getExtractedDocuments starts empty", () => {
    expect(doc.getExtractedDocuments()).toHaveLength(0);
  });

  it("getIngestedFiles accumulates correctly", async () => {
    await executeDocumentJob(envelope("document.ingest", { file_path: "/tmp/test-a.pdf" }), doc);
    expect(doc.getIngestedFiles()).toHaveLength(1);
    await executeDocumentJob(envelope("document.ingest", { file_path: "/tmp/test-b.pdf" }), doc);
    expect(doc.getIngestedFiles()).toHaveLength(2);
    await executeDocumentJob(envelope("document.ingest", { file_path: "/tmp/test-c.pdf" }), doc);
    expect(doc.getIngestedFiles()).toHaveLength(3);
  });

  it("getGeneratedReports accumulates correctly", async () => {
    await executeDocumentJob(envelope("document.generate_report", { template: "custom", data: {}, output_format: "pdf", output_path: "/r1" }), doc);
    await executeDocumentJob(envelope("document.generate_report", { template: "proposal", data: {}, output_format: "docx", output_path: "/r2" }), doc);
    expect(doc.getGeneratedReports()).toHaveLength(2);
  });

  it("getExtractedDocuments accumulates after extractions", async () => {
    await executeDocumentJob(envelope("document.extract_clauses", { file_path: "/c1.pdf", document_type: "nda" }), doc);
    await executeDocumentJob(envelope("document.extract_clauses", { file_path: "/c2.pdf", document_type: "msa" }), doc);
    expect(doc.getExtractedDocuments().length).toBeGreaterThanOrEqual(2);
  });
});

// ── Edge cases ──────────────────────────────────────────────────────────────

describe("Document Exhaustive — edge cases", () => {
  let doc: MockDocumentAdapter;

  beforeEach(() => {
    doc = new MockDocumentAdapter();
  });

  it("invalid job type returns failed", async () => {
    const result = await executeDocumentJob(
      envelope("document.nonexistent_op", { file_path: "/x.pdf" }),
      doc,
    );
    expect(result.status).toBe("failed");
  });

  it("ingest same file twice", async () => {
    await executeDocumentJob(envelope("document.ingest", { file_path: "/tmp/test-dup.pdf" }), doc);
    await executeDocumentJob(envelope("document.ingest", { file_path: "/tmp/test-dup.pdf" }), doc);
    expect(doc.getIngestedFiles()).toBeDefined();
  });
});
