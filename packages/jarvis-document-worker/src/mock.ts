import type { ExecutionOutcome, DocumentAdapter } from "./adapter.js";
import { DocumentWorkerError } from "./adapter.js";
import type {
  DocumentAnalyzeComplianceInput,
  DocumentAnalyzeComplianceOutput,
  DocumentCompareInput,
  DocumentCompareOutput,
  DocumentExtractClausesInput,
  DocumentExtractClausesOutput,
  DocumentGenerateReportInput,
  DocumentGenerateReportOutput,
  DocumentIngestInput,
  DocumentIngestOutput,
  ExtractedClause,
  ComplianceItem
} from "./types.js";

export const MOCK_NOW = "2026-04-04T12:00:00.000Z";

const KNOWN_PATHS = new Set([
  "/tmp/test-nda.pdf",
  "/tmp/test-sow.docx",
  "/tmp/safety-plan.pdf",
  "/tmp/aspice-process.pdf",
  "/tmp/nda-v1.pdf",
  "/tmp/nda-v2.pdf",
  "/tmp/compliance-report.pdf"
]);

export class MockDocumentAdapter implements DocumentAdapter {
  private ingestedFiles: string[] = [];
  private generatedReports: string[] = [];
  private extractedDocuments: string[] = [];

  getIngestedFiles(): string[] {
    return [...this.ingestedFiles];
  }

  getGeneratedReports(): string[] {
    return [...this.generatedReports];
  }

  getExtractedDocuments(): string[] {
    return [...this.extractedDocuments];
  }

  async ingest(input: DocumentIngestInput): Promise<ExecutionOutcome<DocumentIngestOutput>> {
    if (!KNOWN_PATHS.has(input.file_path) && !input.file_path.startsWith("/tmp/test-")) {
      throw new DocumentWorkerError(
        "DOCUMENT_NOT_FOUND",
        `Document not found: ${input.file_path}`,
        false,
        { file_path: input.file_path }
      );
    }

    this.ingestedFiles.push(input.file_path);

    const isNda = input.file_path.includes("nda");
    const isSow = input.file_path.includes("sow");
    const isSafety = input.file_path.includes("safety");

    const sections = input.extract_structure !== false ? [
      {
        heading: "1. Parties",
        level: 1,
        content: "This Agreement is entered into between Acme Corp (\"Disclosing Party\") and Beta Ltd (\"Receiving Party\").",
        page: 1
      },
      {
        heading: "1.1 Definitions",
        level: 2,
        content: "For the purposes of this Agreement, the following definitions apply.",
        page: 1
      },
      {
        heading: isNda
          ? "2. Confidentiality Obligations"
          : isSow
          ? "2. Scope of Work"
          : isSafety
          ? "2. Safety Requirements"
          : "2. General Terms",
        level: 1,
        content: isNda
          ? "The Receiving Party agrees to hold all Confidential Information in strict confidence and not to disclose it to any third party without the prior written consent of the Disclosing Party."
          : isSow
          ? "The Supplier shall deliver the specified deliverables in accordance with the agreed project schedule and quality standards defined herein."
          : isSafety
          ? "All software components classified at ASIL B or higher shall comply with ISO 26262-6 requirements for software development."
          : "The parties agree to the following general terms and conditions.",
        page: 2
      },
      {
        heading: "3. Term and Termination",
        level: 1,
        content: "This Agreement shall commence on the Effective Date and continue for a period of two (2) years unless earlier terminated.",
        page: 3
      },
      {
        heading: "4. Governing Law",
        level: 1,
        content: "This Agreement shall be governed by and construed in accordance with the laws of the Commonwealth of Massachusetts.",
        page: 4
      }
    ] : [];

    const tables = input.extract_tables !== false ? [
      {
        caption: "Deliverables Schedule",
        headers: ["Deliverable", "Due Date", "Acceptance Criteria"],
        rows: [
          ["Software Requirements Specification", "2026-05-01", "Review and sign-off by customer"],
          ["System Architecture Document", "2026-06-01", "Peer review approval"],
          ["Verification & Validation Report", "2026-08-01", "Independent audit pass"]
        ],
        page: 5
      }
    ] : [];

    const wordCount = 3420;
    const pageCount = input.max_pages ?? 12;

    return {
      summary: `Ingested document ${input.file_path}: ${wordCount} words, ${pageCount} pages, ${sections.length} sections extracted.`,
      structured_output: {
        file_path: input.file_path,
        file_type: input.file_path.endsWith(".pdf")
          ? "pdf"
          : input.file_path.endsWith(".docx")
          ? "docx"
          : input.file_path.endsWith(".txt")
          ? "txt"
          : input.file_path.endsWith(".md")
          ? "md"
          : "unknown",
        page_count: pageCount,
        word_count: wordCount,
        text: sections.map((s) => `${s.heading ?? ""}\n${s.content}`).join("\n\n") || "Document text content extracted from " + input.file_path,
        sections,
        tables,
        metadata: {
          author: "John Doe",
          created: "2026-01-15",
          modified: "2026-03-28",
          title: isNda ? "Non-Disclosure Agreement" : isSow ? "Statement of Work" : "Technical Document"
        },
        ingested_at: MOCK_NOW
      }
    };
  }

  async extractClauses(input: DocumentExtractClausesInput): Promise<ExecutionOutcome<DocumentExtractClausesOutput>> {
    const source = input.file_path ?? input.text ?? "";
    this.extractedDocuments.push(source);

    const docType = input.document_type ?? "nda";

    const clauses: ExtractedClause[] = [
      {
        clause_id: "clause-001",
        category: "ip_assignment",
        title: "Intellectual Property Assignment",
        text: "The Receiving Party agrees that all inventions, developments, and improvements made using or derived from Confidential Information shall be assigned to the Disclosing Party in perpetuity, worldwide, without limitation.",
        page: 3,
        risk_level: "critical",
        flags: ["broad_ip_assignment", "perpetual_assignment", "worldwide_scope"]
      },
      {
        clause_id: "clause-002",
        category: "liability_cap",
        title: "Limitation of Liability",
        text: "Neither party shall be liable for any indirect, incidental, special, or consequential damages. However, there is no cap on direct damages arising from breach of this Agreement.",
        page: 5,
        risk_level: "high",
        flags: ["unlimited_liability", "no_damage_cap"]
      },
      {
        clause_id: "clause-003",
        category: "jurisdiction",
        title: "Governing Law and Jurisdiction",
        text: "This Agreement shall be governed by and construed in accordance with the laws of the Commonwealth of Massachusetts, and any disputes shall be subject to the exclusive jurisdiction of the courts of Massachusetts.",
        page: 7,
        risk_level: "high",
        flags: ["unfavorable_jurisdiction", "exclusive_jurisdiction"]
      },
      {
        clause_id: "clause-004",
        category: "confidentiality",
        title: "Confidentiality Obligations",
        text: "The Receiving Party shall maintain the confidentiality of all Confidential Information for a period of five (5) years from the date of disclosure.",
        page: 2,
        risk_level: "medium",
        flags: ["extended_confidentiality_period"]
      },
      {
        clause_id: "clause-005",
        category: "termination",
        title: "Termination for Convenience",
        text: "Either party may terminate this Agreement upon thirty (30) days written notice to the other party.",
        page: 8,
        risk_level: "low",
        flags: []
      }
    ];

    const highRiskCount = clauses.filter((c) => c.risk_level === "high").length;
    const criticalCount = clauses.filter((c) => c.risk_level === "critical").length;

    return {
      summary: `Extracted ${clauses.length} clauses from ${docType} document. Critical risks: ${criticalCount}. High risks: ${highRiskCount}.`,
      structured_output: {
        document_type: docType,
        clauses,
        total_clauses: clauses.length,
        high_risk_count: highRiskCount,
        critical_count: criticalCount,
        extracted_at: MOCK_NOW
      }
    };
  }

  async analyzeCompliance(input: DocumentAnalyzeComplianceInput): Promise<ExecutionOutcome<DocumentAnalyzeComplianceOutput>> {
    const framework = input.framework;
    const projectAsil = input.project_asil ?? "B";

    const items: ComplianceItem[] = [
      {
        requirement_id: "ISO26262-6:2018-7.4.1",
        requirement: "Software architectural design shall be developed",
        framework,
        asil_level: "B",
        status: "present",
        evidence: "Section 4.2 describes the software architectural design with component breakdown."
      },
      {
        requirement_id: "ISO26262-6:2018-7.4.2",
        requirement: "Software unit design shall be developed",
        framework,
        asil_level: "B",
        status: "partial",
        evidence: "Unit design is partially documented in Appendix A.",
        gap_description: "Missing formal DIA (Design Interface Agreement) for 3 of 12 software units."
      },
      {
        requirement_id: "ISO26262-6:2018-7.4.3",
        requirement: "Unit test plan shall be created",
        framework,
        asil_level: "B",
        status: "missing",
        gap_description: "No unit test plan found in the document. This is a critical gap for ASIL B."
      },
      {
        requirement_id: "ISO26262-6:2018-7.4.4",
        requirement: "Software integration test specification",
        framework,
        asil_level: "A",
        status: "present",
        evidence: "Integration test specification found in Section 6.3."
      },
      {
        requirement_id: "ISO26262-6:2018-7.4.5",
        requirement: "Technical Safety Requirement traceability",
        framework,
        asil_level: "B",
        status: "partial",
        evidence: "TSR traceability matrix found but incomplete.",
        gap_description: "TSR incomplete: 8 of 23 technical safety requirements lack traceability to test cases."
      },
      {
        requirement_id: "ISO26262-6:2018-7.4.6",
        requirement: "Dependency failure analysis (DIA)",
        framework,
        asil_level: "C",
        status: "missing",
        gap_description: "No Dependency Failure Impact Analysis document found. Required for ASIL C and above."
      },
      {
        requirement_id: "ISO26262-6:2018-7.4.7",
        requirement: "Software qualification test specification",
        framework,
        asil_level: "A",
        status: "present",
        evidence: "Qualification test procedures documented in Section 7."
      }
    ];

    const presentCount = items.filter((i) => i.status === "present").length;
    const missingCount = items.filter((i) => i.status === "missing").length;
    const partialCount = items.filter((i) => i.status === "partial").length;
    const totalRequirements = items.length;

    // Score: present = 1.0, partial = 0.5, missing = 0, not_applicable = excluded
    const scoreNumerator = presentCount + partialCount * 0.5;
    const complianceScore = Math.round((scoreNumerator / totalRequirements) * 100);

    const criticalGaps = [
      "Missing DIA (Dependency Failure Impact Analysis) - required for ASIL B+",
      "TSR (Technical Safety Requirement) traceability incomplete: 8 of 23 requirements without test case links",
      "No unit test plan present - critical gap for ASIL B software"
    ];

    return {
      summary: `${framework} compliance analysis: ${complianceScore}% score. ${missingCount} missing, ${partialCount} partial, ${presentCount} present requirements. ${criticalGaps.length} critical gaps identified.`,
      structured_output: {
        framework,
        project_asil: projectAsil,
        total_requirements: totalRequirements,
        present_count: presentCount,
        missing_count: missingCount,
        partial_count: partialCount,
        compliance_score: complianceScore,
        items,
        critical_gaps: criticalGaps,
        analyzed_at: MOCK_NOW
      }
    };
  }

  async compare(input: DocumentCompareInput): Promise<ExecutionOutcome<DocumentCompareOutput>> {
    const changes = [
      {
        change_type: "modified" as const,
        section: "Intellectual Property Assignment",
        description: "IP assignment clause broadened to include pre-existing IP developed by Receiving Party prior to engagement.",
        significance: "major" as const
      },
      {
        change_type: "modified" as const,
        section: "Governing Law",
        description: "Jurisdiction changed from Delaware to Massachusetts, adding exclusive jurisdiction clause.",
        significance: "major" as const
      },
      {
        change_type: "added" as const,
        section: "Non-Compete",
        description: "New non-compete clause added restricting Receiving Party from working with competitors for 24 months.",
        significance: "major" as const
      },
      {
        change_type: "modified" as const,
        section: "Confidentiality Period",
        description: "Confidentiality period extended from 3 years to 5 years.",
        significance: "moderate" as const
      },
      {
        change_type: "removed" as const,
        section: "Limitation of Liability",
        description: "Mutual limitation of liability cap of $1M USD removed from Agreement.",
        significance: "major" as const
      },
      {
        change_type: "added" as const,
        section: "Definitions",
        description: "Added definition for 'Derivative Works' to Definitions section.",
        significance: "minor" as const
      },
      {
        change_type: "modified" as const,
        section: "Notice Period",
        description: "Notice period for termination changed from 30 days to 60 days.",
        significance: "minor" as const
      }
    ];

    const majorChanges = changes.filter((c) => c.significance === "major").length;

    return {
      summary: `Compared ${input.file_path_a} vs ${input.file_path_b}: ${changes.length} changes found, ${majorChanges} major.`,
      structured_output: {
        file_a: input.file_path_a,
        file_b: input.file_path_b,
        total_changes: changes.length,
        major_changes: majorChanges,
        changes,
        similarity_score: 0.72,
        compared_at: MOCK_NOW
      }
    };
  }

  async generateReport(input: DocumentGenerateReportInput): Promise<ExecutionOutcome<DocumentGenerateReportOutput>> {
    this.generatedReports.push(input.output_path);

    const title = input.title ?? `${input.template.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} Report`;
    const sectionCount = input.template === "evidence_gap"
      ? 6
      : input.template === "compliance_summary"
      ? 5
      : input.template === "nda_analysis"
      ? 7
      : input.template === "proposal"
      ? 8
      : 4;

    const timestamp = MOCK_NOW.replace(/[:.]/g, "-").replace("T", "_").replace("Z", "");
    const outputPath = input.output_path.includes(".")
      ? input.output_path
      : `${input.output_path}_${timestamp}.${input.output_format}`;

    return {
      summary: `Generated ${input.template} report as ${input.output_format}: ${title} with ${sectionCount} sections at ${outputPath}.`,
      structured_output: {
        output_path: outputPath,
        output_format: input.output_format,
        template: input.template,
        title,
        section_count: sectionCount,
        generated_at: MOCK_NOW
      }
    };
  }
}

export function createMockDocumentAdapter(): DocumentAdapter {
  return new MockDocumentAdapter();
}
