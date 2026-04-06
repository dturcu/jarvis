import { Type } from "@sinclair/typebox";
import {
  definePluginEntry,
  type AnyAgentTool,
  type OpenClawPluginToolContext,
  type PluginCommandContext
} from "openclaw/plugin-sdk/plugin-entry";
import {
  DOCUMENT_TOOL_NAMES,
  DOCUMENT_COMMAND_NAMES,
  getJarvisState,
  safeJsonParse,
  submitDocumentIngest,
  submitDocumentExtractClauses,
  submitDocumentAnalyzeCompliance,
  submitDocumentCompare,
  submitDocumentGenerateReport,
  toCommandReply,
  toToolResult,
  type ToolResponse
} from "@jarvis/shared";

function asLiteralUnion<const Values extends readonly [string, ...string[]]>(
  values: Values,
) {
  return Type.Union(values.map((value) => Type.Literal(value)) as [any, any, ...any[]]);
}

const complianceFrameworkSchema = asLiteralUnion([
  "iso_26262",
  "aspice",
  "iec_61508",
  "iso_21434"
] as const);

const compareModeSchema = asLiteralUnion(["full", "sections", "clauses"] as const);
const reportTemplateSchema = asLiteralUnion(["proposal", "evidence_gap", "compliance_summary", "nda_analysis", "custom"] as const);
const outputFormatSchema = asLiteralUnion(["docx", "pdf", "markdown"] as const);
const documentTypeSchema = asLiteralUnion(["nda", "msa", "sow", "contract", "agreement"] as const);
const asilSchema = asLiteralUnion(["A", "B", "C", "D"] as const);

function createDocumentTool(
  ctx: OpenClawPluginToolContext,
  name: string,
  label: string,
  description: string,
  parameters: ReturnType<typeof Type.Object>,
  submit: (ctx: OpenClawPluginToolContext | undefined, params: any) => ToolResponse,
): AnyAgentTool {
  return {
    name,
    label,
    description,
    parameters,
    execute: async (_toolCallId, params) => toToolResult(submit(ctx, params))
  };
}

export function createDocumentTools(
  ctx: OpenClawPluginToolContext,
): AnyAgentTool[] {
  return [
    createDocumentTool(
      ctx,
      "document_ingest",
      "Document Ingest",
      "Parse PDF, DOCX, TXT, or MD files and extract text, structure, and tables.",
      Type.Object({
        file_path: Type.String({ minLength: 1, description: "Path to the document to ingest." }),
        extract_structure: Type.Optional(Type.Boolean({ description: "Extract headings and sections." })),
        extract_tables: Type.Optional(Type.Boolean({ description: "Extract tables from the document." })),
        max_pages: Type.Optional(Type.Integer({ minimum: 1, description: "Maximum number of pages to process." }))
      }),
      (toolCtx, params: { file_path: string; extract_structure?: boolean; extract_tables?: boolean; max_pages?: number }) =>
        submitDocumentIngest(toolCtx, {
          filePath: params.file_path,
          extractStructure: params.extract_structure,
          extractTables: params.extract_tables,
          maxPages: params.max_pages
        })
    ),
    createDocumentTool(
      ctx,
      "document_extract_clauses",
      "Document Extract Clauses",
      "Extract and classify clauses from NDA, MSA, SOW, or contract documents with risk assessment.",
      Type.Object({
        file_path: Type.Optional(Type.String({ minLength: 1, description: "Path to the document." })),
        text: Type.Optional(Type.String({ minLength: 1, description: "Raw document text to analyze." })),
        document_type: Type.Optional(documentTypeSchema)
      }),
      (toolCtx, params: { file_path?: string; text?: string; document_type?: string }) =>
        submitDocumentExtractClauses(toolCtx, {
          filePath: params.file_path,
          text: params.text,
          documentType: params.document_type as any
        })
    ),
    createDocumentTool(
      ctx,
      "document_analyze_compliance",
      "Document Analyze Compliance",
      "Analyze document compliance against ISO 26262, ASPICE, IEC 61508, or ISO 21434 frameworks.",
      Type.Object({
        file_path: Type.Optional(Type.String({ minLength: 1, description: "Path to the document." })),
        text: Type.Optional(Type.String({ minLength: 1, description: "Raw document text to analyze." })),
        framework: complianceFrameworkSchema,
        project_asil: Type.Optional(asilSchema),
        work_product_type: Type.Optional(Type.String({ minLength: 1, description: "Work product type, e.g. software_plan, dv_report, tsr, dia." }))
      }),
      (toolCtx, params: { file_path?: string; text?: string; framework: string; project_asil?: string; work_product_type?: string }) =>
        submitDocumentAnalyzeCompliance(toolCtx, {
          filePath: params.file_path,
          text: params.text,
          framework: params.framework as any,
          projectAsil: params.project_asil as any,
          workProductType: params.work_product_type
        })
    ),
    createDocumentTool(
      ctx,
      "document_compare",
      "Document Compare",
      "Compare two document versions and identify additions, removals, and modifications.",
      Type.Object({
        file_path_a: Type.String({ minLength: 1, description: "Path to the first document." }),
        file_path_b: Type.String({ minLength: 1, description: "Path to the second document." }),
        compare_mode: Type.Optional(compareModeSchema)
      }),
      (toolCtx, params: { file_path_a: string; file_path_b: string; compare_mode?: string }) =>
        submitDocumentCompare(toolCtx, {
          filePathA: params.file_path_a,
          filePathB: params.file_path_b,
          compareMode: params.compare_mode as any
        })
    ),
    createDocumentTool(
      ctx,
      "document_generate_report",
      "Document Generate Report",
      "Generate a structured report from a template (evidence gap, compliance summary, NDA analysis, etc.).",
      Type.Object({
        template: reportTemplateSchema,
        data: Type.Object({}, { additionalProperties: true, description: "Template data payload." }),
        output_format: outputFormatSchema,
        output_path: Type.String({ minLength: 1, description: "Output file path for the generated report." }),
        title: Type.Optional(Type.String({ minLength: 1, description: "Report title." }))
      }),
      (toolCtx, params: { template: string; data: Record<string, unknown>; output_format: string; output_path: string; title?: string }) =>
        submitDocumentGenerateReport(toolCtx, {
          template: params.template as any,
          data: params.data,
          outputFormat: params.output_format as any,
          outputPath: params.output_path,
          title: params.title
        })
    )
  ];
}

type DocumentCommandArgs = {
  operation: "ingest" | "extract_clauses" | "analyze_compliance" | "compare" | "generate_report";
  filePath?: string;
  filePathA?: string;
  filePathB?: string;
  framework?: string;
  template?: string;
  outputPath?: string;
  outputFormat?: string;
  documentType?: string;
};

type AnalyzeCommandArgs = {
  framework: "iso_26262" | "aspice" | "iec_61508" | "iso_21434";
  filePath?: string;
  text?: string;
  projectAsil?: "A" | "B" | "C" | "D";
  workProductType?: string;
};

function formatJobReply(response: ToolResponse): string {
  const parts = [response.summary];
  if (response.job_id) {
    parts.push(`job=${response.job_id}`);
  }
  if (response.approval_id) {
    parts.push(`approval=${response.approval_id}`);
  }
  return parts.join(" | ");
}

function parseJsonArgs<T>(ctx: PluginCommandContext): T | null {
  return safeJsonParse<T>(ctx.args);
}

function toToolContext(ctx: PluginCommandContext): OpenClawPluginToolContext {
  return {
    sessionKey: ctx.sessionKey,
    sessionId: ctx.sessionId,
    messageChannel: ctx.channel,
    requesterSenderId: ctx.senderId
  };
}

function invalidJsonReply(commandName: string) {
  return toCommandReply(`Invalid JSON arguments for /${commandName}.`, true);
}

export function createDocumentCommand() {
  return {
    name: "document",
    description: "Document intelligence operations: ingest, extract_clauses, analyze_compliance, compare, generate_report.",
    acceptsArgs: true,
    handler: (ctx: PluginCommandContext) => {
      const args = parseJsonArgs<DocumentCommandArgs>(ctx);
      if (!args) {
        return invalidJsonReply("document");
      }

      const toolCtx = toToolContext(ctx);

      switch (args.operation) {
        case "ingest": {
          if (!args.filePath) {
            return toCommandReply("Usage: /document {\"operation\":\"ingest\",\"filePath\":\"...\"}.", true);
          }
          const response = submitDocumentIngest(toolCtx, { filePath: args.filePath });
          return toCommandReply(formatJobReply(response));
        }
        case "extract_clauses": {
          const response = submitDocumentExtractClauses(toolCtx, {
            filePath: args.filePath,
            documentType: args.documentType as any
          });
          return toCommandReply(formatJobReply(response));
        }
        case "analyze_compliance": {
          if (!args.framework) {
            return toCommandReply("Usage: /document {\"operation\":\"analyze_compliance\",\"framework\":\"iso_26262\"}.", true);
          }
          const response = submitDocumentAnalyzeCompliance(toolCtx, {
            filePath: args.filePath,
            framework: args.framework as any
          });
          return toCommandReply(formatJobReply(response));
        }
        case "compare": {
          if (!args.filePathA || !args.filePathB) {
            return toCommandReply("Usage: /document {\"operation\":\"compare\",\"filePathA\":\"...\",\"filePathB\":\"...\"}.", true);
          }
          const response = submitDocumentCompare(toolCtx, {
            filePathA: args.filePathA,
            filePathB: args.filePathB
          });
          return toCommandReply(formatJobReply(response));
        }
        case "generate_report": {
          if (!args.template || !args.outputPath || !args.outputFormat) {
            return toCommandReply("Usage: /document {\"operation\":\"generate_report\",\"template\":\"...\",\"outputPath\":\"...\",\"outputFormat\":\"...\"}.", true);
          }
          const response = submitDocumentGenerateReport(toolCtx, {
            template: args.template as any,
            data: {},
            outputFormat: args.outputFormat as any,
            outputPath: args.outputPath
          });
          return toCommandReply(formatJobReply(response));
        }
        default:
          return toCommandReply(
            `Unsupported /document operation: ${String((args as DocumentCommandArgs).operation)}. Valid: ingest, extract_clauses, analyze_compliance, compare, generate_report.`,
            true
          );
      }
    }
  };
}

export function createAnalyzeCommand() {
  return {
    name: "analyze",
    description: "Analyze document compliance against automotive safety standards (ISO 26262, ASPICE, etc.).",
    acceptsArgs: true,
    handler: (ctx: PluginCommandContext) => {
      const args = parseJsonArgs<AnalyzeCommandArgs>(ctx);
      if (!args || !args.framework) {
        return toCommandReply("Usage: /analyze {\"framework\":\"iso_26262\",\"filePath\":\"...\"}.", true);
      }

      const toolCtx = toToolContext(ctx);
      const response = submitDocumentAnalyzeCompliance(toolCtx, {
        filePath: args.filePath,
        text: args.text,
        framework: args.framework,
        projectAsil: args.projectAsil,
        workProductType: args.workProductType
      });
      return toCommandReply(formatJobReply(response));
    }
  };
}

export const jarvisDocumentToolNames = [...DOCUMENT_TOOL_NAMES];
export const jarvisDocumentCommandNames = [...DOCUMENT_COMMAND_NAMES];

export default definePluginEntry({
  id: "jarvis-document",
  name: "Jarvis Document",
  description: "Document intelligence plugin for ingestion, clause extraction, compliance analysis, comparison, and report generation",
  register(api) {
    api.registerTool((ctx) => createDocumentTools(ctx));
    api.registerCommand(createDocumentCommand());
    api.registerCommand(createAnalyzeCommand());
  }
});
