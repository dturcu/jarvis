import type { OpenClawPluginToolContext } from "openclaw/plugin-sdk/plugin-entry";
import { getJarvisState } from "./state.js";
import type { ToolResponse } from "./types.js";

export type DocumentIngestParams = {
  filePath: string;
  extractStructure?: boolean;
  extractTables?: boolean;
  maxPages?: number;
};

export type DocumentExtractClausesParams = {
  filePath?: string;
  text?: string;
  documentType?: "nda" | "msa" | "sow" | "contract" | "agreement";
};

export type DocumentAnalyzeComplianceParams = {
  filePath?: string;
  text?: string;
  framework: "iso_26262" | "aspice" | "iec_61508" | "iso_21434";
  projectAsil?: "A" | "B" | "C" | "D";
  workProductType?: string;
};

export type DocumentCompareParams = {
  filePathA: string;
  filePathB: string;
  compareMode?: "full" | "sections" | "clauses";
};

export type DocumentGenerateReportParams = {
  template: "proposal" | "evidence_gap" | "compliance_summary" | "nda_analysis" | "custom";
  data: Record<string, unknown>;
  outputFormat: "docx" | "pdf" | "markdown";
  outputPath: string;
  title?: string;
};

export function submitDocumentIngest(
  ctx: OpenClawPluginToolContext | undefined,
  params: DocumentIngestParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "document.ingest",
    input: {
      file_path: params.filePath,
      extract_structure: params.extractStructure,
      extract_tables: params.extractTables,
      max_pages: params.maxPages
    }
  });
}

export function submitDocumentExtractClauses(
  ctx: OpenClawPluginToolContext | undefined,
  params: DocumentExtractClausesParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "document.extract_clauses",
    input: {
      file_path: params.filePath,
      text: params.text,
      document_type: params.documentType
    }
  });
}

export function submitDocumentAnalyzeCompliance(
  ctx: OpenClawPluginToolContext | undefined,
  params: DocumentAnalyzeComplianceParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "document.analyze_compliance",
    input: {
      file_path: params.filePath,
      text: params.text,
      framework: params.framework,
      project_asil: params.projectAsil,
      work_product_type: params.workProductType
    }
  });
}

export function submitDocumentCompare(
  ctx: OpenClawPluginToolContext | undefined,
  params: DocumentCompareParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "document.compare",
    input: {
      file_path_a: params.filePathA,
      file_path_b: params.filePathB,
      compare_mode: params.compareMode
    }
  });
}

export function submitDocumentGenerateReport(
  ctx: OpenClawPluginToolContext | undefined,
  params: DocumentGenerateReportParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "document.generate_report",
    input: {
      template: params.template,
      data: params.data,
      output_format: params.outputFormat,
      output_path: params.outputPath,
      title: params.title
    }
  });
}
