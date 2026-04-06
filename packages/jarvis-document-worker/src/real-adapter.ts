import fs from "node:fs";
import { extname } from "node:path";
import { randomUUID } from "node:crypto";
import type { DocumentAdapter, ExecutionOutcome } from "./adapter.js";
import type {
  DocumentIngestInput, DocumentIngestOutput,
  DocumentExtractClausesInput, DocumentExtractClausesOutput,
  DocumentAnalyzeComplianceInput, DocumentAnalyzeComplianceOutput,
  DocumentCompareInput, DocumentCompareOutput,
  DocumentGenerateReportInput, DocumentGenerateReportOutput,
  DocumentSection, ExtractedClause, ComplianceItem, DocumentChange,
} from "./types.js";

/**
 * A function that calls an LLM and returns the text response.
 * Injected by the caller so the adapter doesn't depend on inference internals.
 */
export type LlmChatFn = (prompt: string, systemPrompt?: string) => Promise<string>;

/**
 * Real document adapter that parses PDF/DOCX/TXT files and uses an LLM
 * for clause extraction, compliance analysis, and document comparison.
 */
export class RealDocumentAdapter implements DocumentAdapter {
  constructor(private readonly chat: LlmChatFn) {}

  async ingest(input: DocumentIngestInput): Promise<ExecutionOutcome<DocumentIngestOutput>> {
    const ext = extname(input.file_path).toLowerCase();
    let text: string;
    let pageCount: number | undefined;

    if (ext === ".pdf") {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = (await import(/* webpackIgnore: true */ "pdf-parse" as string)).default as (buf: Buffer, opts?: Record<string, unknown>) => Promise<{ text: string; numpages: number }>;
      const buffer = fs.readFileSync(input.file_path);
      const data = await pdfParse(buffer, { max: input.max_pages });
      text = data.text;
      pageCount = data.numpages;
    } else if (ext === ".docx") {
      const mammoth = (await import(/* webpackIgnore: true */ "mammoth" as string)) as { extractRawText: (opts: { path: string }) => Promise<{ value: string }> };
      const result = await mammoth.extractRawText({ path: input.file_path });
      text = result.value;
    } else {
      text = fs.readFileSync(input.file_path, "utf8");
    }

    const wordCount = text.split(/\s+/).filter(Boolean).length;
    const sections = input.extract_structure !== false ? parseSections(text) : [];
    const fileType = resolveFileType(ext);

    return {
      summary: `Ingested ${fileType} document (${wordCount} words${pageCount ? `, ${pageCount} pages` : ""})`,
      structured_output: {
        file_path: input.file_path,
        file_type: fileType,
        page_count: pageCount,
        word_count: wordCount,
        text,
        sections,
        tables: [], // table extraction is complex — stub for now
        metadata: {},
        ingested_at: new Date().toISOString(),
      },
    };
  }

  async extractClauses(input: DocumentExtractClausesInput): Promise<ExecutionOutcome<DocumentExtractClausesOutput>> {
    let text = input.text;
    if (!text && input.file_path) {
      const result = await this.ingest({ file_path: input.file_path });
      text = result.structured_output.text;
    }
    if (!text) throw new Error("Either file_path or text is required");

    const docType = input.document_type ?? "contract";
    const prompt = `Analyze this ${docType} and extract all clauses.

For each clause, output a JSON object with these fields:
- clause_id: unique identifier (e.g., "c1", "c2")
- category: one of "jurisdiction", "term", "confidentiality", "ip_assignment", "indemnity", "liability_cap", "non_compete", "termination", "payment", "warranty", "general"
- title: short title for the clause
- text: the actual clause text (abbreviated to key language)
- risk_level: "low", "medium", "high", or "critical"
- flags: array of specific concerns (e.g., "unlimited_liability", "broad_ip_assignment", "non_standard_indemnity")

Focus on: jurisdiction risk (prefer EU/RO), term >5yr, broad IP assignment, unlimited liability, non-standard indemnity, broad non-compete.

Output ONLY a JSON array of clause objects, no markdown, no explanation.

Document text:
${text.slice(0, 8000)}`;

    const response = await this.chat(prompt);
    let clauses: ExtractedClause[];
    try {
      clauses = JSON.parse(extractJson(response)) as ExtractedClause[];
    } catch {
      clauses = [];
    }

    const highRisk = clauses.filter(c => c.risk_level === "high").length;
    const critical = clauses.filter(c => c.risk_level === "critical").length;

    return {
      summary: `Extracted ${clauses.length} clauses (${highRisk} high risk, ${critical} critical)`,
      structured_output: {
        document_type: docType,
        clauses,
        total_clauses: clauses.length,
        high_risk_count: highRisk,
        critical_count: critical,
        extracted_at: new Date().toISOString(),
      },
    };
  }

  async analyzeCompliance(input: DocumentAnalyzeComplianceInput): Promise<ExecutionOutcome<DocumentAnalyzeComplianceOutput>> {
    let text = input.text;
    if (!text && input.file_path) {
      const result = await this.ingest({ file_path: input.file_path });
      text = result.structured_output.text;
    }
    if (!text) throw new Error("Either file_path or text is required");

    const prompt = `Analyze this document for ${input.framework.toUpperCase()} compliance${input.project_asil ? ` at ASIL-${input.project_asil}` : ""}${input.work_product_type ? ` (work product: ${input.work_product_type})` : ""}.

For each requirement, output a JSON object with:
- requirement_id: the standard clause ID (e.g., "6.4.1", "SWE.3.BP1")
- requirement: short description
- framework: "${input.framework}"
- status: "present", "missing", "partial", or "not_applicable"
- evidence: quote from document if present
- gap_description: what's missing if not fully present

Output ONLY a JSON array, no markdown.

Document text:
${text.slice(0, 8000)}`;

    const response = await this.chat(prompt);
    let items: ComplianceItem[];
    try {
      items = JSON.parse(extractJson(response)) as ComplianceItem[];
    } catch {
      items = [];
    }

    const present = items.filter(i => i.status === "present").length;
    const missing = items.filter(i => i.status === "missing").length;
    const partial = items.filter(i => i.status === "partial").length;
    const applicable = items.filter(i => i.status !== "not_applicable").length;
    const score = applicable > 0 ? Math.round((present / applicable) * 100) : 0;

    return {
      summary: `${input.framework.toUpperCase()} compliance: ${score}% (${present} present, ${missing} missing, ${partial} partial)`,
      structured_output: {
        framework: input.framework,
        project_asil: input.project_asil,
        total_requirements: items.length,
        present_count: present,
        missing_count: missing,
        partial_count: partial,
        compliance_score: score,
        items,
        critical_gaps: items.filter(i => i.status === "missing").map(i => `${i.requirement_id}: ${i.requirement}`),
        analyzed_at: new Date().toISOString(),
      },
    };
  }

  async compare(input: DocumentCompareInput): Promise<ExecutionOutcome<DocumentCompareOutput>> {
    const resultA = await this.ingest({ file_path: input.file_path_a });
    const resultB = await this.ingest({ file_path: input.file_path_b });
    const textA = resultA.structured_output.text;
    const textB = resultB.structured_output.text;

    const prompt = `Compare these two document versions and identify changes.

For each change, output a JSON object with:
- change_type: "added", "removed", or "modified"
- section: which section was affected
- description: what changed
- significance: "minor", "moderate", or "major"

Output ONLY a JSON array of change objects.

DOCUMENT A:
${textA.slice(0, 4000)}

DOCUMENT B:
${textB.slice(0, 4000)}`;

    const response = await this.chat(prompt);
    let changes: DocumentChange[];
    try {
      changes = JSON.parse(extractJson(response)) as DocumentChange[];
    } catch {
      changes = [];
    }

    // Compute basic similarity (Jaccard on words)
    const wordsA = new Set(textA.toLowerCase().split(/\s+/));
    const wordsB = new Set(textB.toLowerCase().split(/\s+/));
    const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
    const union = new Set([...wordsA, ...wordsB]).size;
    const similarity = union > 0 ? Math.round((intersection / union) * 100) / 100 : 0;

    return {
      summary: `Compared documents: ${changes.length} changes, ${Math.round(similarity * 100)}% similarity`,
      structured_output: {
        file_a: input.file_path_a,
        file_b: input.file_path_b,
        total_changes: changes.length,
        major_changes: changes.filter(c => c.significance === "major").length,
        changes,
        similarity_score: similarity,
        compared_at: new Date().toISOString(),
      },
    };
  }

  async generateReport(input: DocumentGenerateReportInput): Promise<ExecutionOutcome<DocumentGenerateReportOutput>> {
    const title = input.title ?? `${input.template} Report`;
    const prompt = `Generate a ${input.template} report titled "${title}".

Data: ${JSON.stringify(input.data).slice(0, 4000)}

Output the report in markdown format with clear sections, headings, and bullet points. Be structured and professional.`;

    const content = await this.chat(prompt);

    // For markdown output, write directly
    if (input.output_format === "markdown") {
      fs.writeFileSync(input.output_path, content);
    } else {
      // For docx/pdf, write markdown for now (proper conversion would need additional libraries)
      fs.writeFileSync(input.output_path, content);
    }

    const sectionCount = (content.match(/^#{1,3}\s/gm) ?? []).length;

    return {
      summary: `Generated ${input.template} report: ${title} (${sectionCount} sections)`,
      structured_output: {
        output_path: input.output_path,
        output_format: input.output_format,
        template: input.template,
        title,
        section_count: sectionCount,
        generated_at: new Date().toISOString(),
      },
    };
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function resolveFileType(ext: string): "pdf" | "docx" | "txt" | "md" | "unknown" {
  switch (ext) {
    case ".pdf": return "pdf";
    case ".docx": return "docx";
    case ".txt": return "txt";
    case ".md": return "md";
    default: return "unknown";
  }
}

function parseSections(text: string): DocumentSection[] {
  const lines = text.split("\n");
  const sections: DocumentSection[] = [];
  let current: DocumentSection | null = null;

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      if (current) sections.push(current);
      current = {
        heading: headingMatch[2]!,
        level: headingMatch[1]!.length,
        content: "",
      };
    } else if (current) {
      current.content += line + "\n";
    } else {
      // Content before first heading
      if (line.trim()) {
        if (!current) {
          current = { content: "" };
        }
        current.content += line + "\n";
      }
    }
  }
  if (current) sections.push(current);
  return sections;
}

function extractJson(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch?.[1]) return fenceMatch[1].trim();
  const arrayStart = text.indexOf("[");
  const arrayEnd = text.lastIndexOf("]");
  if (arrayStart !== -1 && arrayEnd > arrayStart) return text.slice(arrayStart, arrayEnd + 1);
  return text.trim();
}
