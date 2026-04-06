import { Type } from "@sinclair/typebox";
import {
  definePluginEntry,
  type AnyAgentTool,
  type OpenClawPluginToolContext,
  type PluginCommandContext
} from "openclaw/plugin-sdk/plugin-entry";
import {
  OFFICE_COMMAND_NAMES,
  OFFICE_TOOL_NAMES,
  getJarvisState,
  safeJsonParse,
  submitOfficeBuildPptx,
  submitOfficeExtractTables,
  submitOfficeFillDocx,
  submitOfficeInspect,
  submitOfficeMergeExcel,
  submitOfficePreview,
  submitOfficeTransform,
  toCommandReply,
  toToolResult,
  type OfficeBuildPptxParams,
  type OfficeExtractTablesParams,
  type OfficeFillDocxParams,
  type OfficeInspectParams,
  type OfficeMergeExcelParams,
  type OfficePreviewParams,
  type OfficeTransformParams,
  type ToolResponse
} from "@jarvis/shared";

type ExcelCommandArgs = {
  operation: "inspect" | "transform_excel" | "merge_excel" | "extract_tables" | "preview";
  artifactIds?: string[];
  artifactId?: string;
  inspectMode?: OfficeInspectParams["inspectMode"];
  outputMode?: OfficeInspectParams["outputMode"];
  mode?: OfficeMergeExcelParams["mode"];
  outputName?: string;
  sheetMode?: OfficeTransformParams["sheetMode"];
  sheetPolicy?: OfficeMergeExcelParams["sheetPolicy"];
  sheetName?: string;
  selectColumns?: string[];
  renameColumns?: Record<string, string>;
  dedupeKeys?: string[];
  format?: OfficeExtractTablesParams["format"] | OfficePreviewParams["format"];
};

type WordCommandArgs = OfficeFillDocxParams;

type PptCommandArgs = OfficeBuildPptxParams;

function asLiteralUnion<const Values extends readonly [string, ...string[]]>(
  values: Values,
) {
  return Type.Union(values.map((value) => Type.Literal(value)) as [any, any, ...any[]]);
}

const inspectModeSchema = asLiteralUnion(["auto", "excel", "word", "powerpoint"] as const);
const outputModeSchema = asLiteralUnion(["summary", "json"] as const);
const mergeModeSchema = asLiteralUnion([
  "by_header_union",
  "append_rows_by_sheet",
  "by_sheet_name"
] as const);
const sheetModeSchema = asLiteralUnion(["first_sheet", "named_sheet", "all_sheets"] as const);
const sheetPolicySchema = asLiteralUnion(["first_sheet", "all_sheets", "named_sheet"] as const);
const themeSchema = asLiteralUnion([
  "corporate_clean",
  "minimal_light",
  "minimal_dark",
  "executive_brief"
] as const);
const previewFormatSchema = asLiteralUnion(["png", "pdf", "html", "text"] as const);
const tableFormatSchema = asLiteralUnion(["json", "csv", "xlsx"] as const);

function createOfficeTool(
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

export function createOfficeTools(ctx: OpenClawPluginToolContext): AnyAgentTool[] {
  return [
    createOfficeTool(
      ctx,
      "office_inspect",
      "Office Inspect",
      "Inspect one or more office artifacts.",
      Type.Object({
        artifactIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
        inspectMode: Type.Optional(inspectModeSchema),
        outputMode: Type.Optional(outputModeSchema)
      }),
      submitOfficeInspect
    ),
    createOfficeTool(
      ctx,
      "office_transform",
      "Office Transform",
      "Transform a spreadsheet artifact into a normalized workbook.",
      Type.Object({
        artifactId: Type.String({ minLength: 1 }),
        outputName: Type.String({ minLength: 1 }),
        sheetMode: Type.Optional(sheetModeSchema),
        sheetName: Type.Optional(Type.String({ minLength: 1 })),
        selectColumns: Type.Optional(
          Type.Array(Type.String({ minLength: 1 }), { minItems: 1 })
        ),
        renameColumns: Type.Optional(Type.Record(Type.String({ minLength: 1 }), Type.String()))
      }),
      submitOfficeTransform
    ),
    createOfficeTool(
      ctx,
      "office_merge_excel",
      "Office Merge Excel",
      "Merge multiple Excel files into one workbook.",
      Type.Object({
        artifactIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
        mode: mergeModeSchema,
        outputName: Type.String({ minLength: 1 }),
        sheetPolicy: Type.Optional(sheetPolicySchema),
        sheetName: Type.Optional(Type.String({ minLength: 1 })),
        dedupeKeys: Type.Optional(
          Type.Array(Type.String({ minLength: 1 }), { minItems: 1 })
        )
      }),
      submitOfficeMergeExcel
    ),
    createOfficeTool(
      ctx,
      "office_fill_docx",
      "Office Fill Docx",
      "Fill a Word template with structured variables.",
      Type.Object({
        templateArtifactId: Type.String({ minLength: 1 }),
        variables: Type.Record(Type.String({ minLength: 1 }), Type.Unknown()),
        outputName: Type.String({ minLength: 1 }),
        strictVariables: Type.Optional(Type.Boolean())
      }),
      submitOfficeFillDocx
    ),
    createOfficeTool(
      ctx,
      "office_build_pptx",
      "Office Build Pptx",
      "Generate a presentation from an outline or structured source.",
      Type.Object({
        source: Type.Record(Type.String({ minLength: 1 }), Type.Unknown()),
        theme: themeSchema,
        outputName: Type.String({ minLength: 1 }),
        speakerNotes: Type.Optional(Type.Boolean())
      }),
      submitOfficeBuildPptx
    ),
    createOfficeTool(
      ctx,
      "office_extract_tables",
      "Office Extract Tables",
      "Extract tables from a document or spreadsheet artifact.",
      Type.Object({
        artifactId: Type.String({ minLength: 1 }),
        format: tableFormatSchema,
        outputName: Type.String({ minLength: 1 })
      }),
      submitOfficeExtractTables
    ),
    createOfficeTool(
      ctx,
      "office_preview",
      "Office Preview",
      "Render a preview artifact for an office file.",
      Type.Object({
        artifactId: Type.String({ minLength: 1 }),
        format: previewFormatSchema,
        outputName: Type.String({ minLength: 1 })
      }),
      submitOfficePreview
    )
  ];
}

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

function missingJsonReply(commandName: string, usage: string): ReturnType<typeof toCommandReply> {
  return toCommandReply(`Usage: /${commandName} ${usage}`, true);
}

function invalidJsonReply(commandName: string): ReturnType<typeof toCommandReply> {
  return toCommandReply(`Invalid JSON arguments for /${commandName}.`, true);
}

export function createOfficeStatusCommand() {
  return {
    name: "office-status",
    description: "Show the in-memory Jarvis office queue state.",
    acceptsArgs: false,
    handler: () => {
      const stats = getJarvisState().getStats();
      return toCommandReply(
        `Office broker online. jobs=${stats.jobs} approvals=${stats.approvals} dispatches=${stats.dispatches}.`
      );
    }
  };
}

export function createExcelCommand() {
  return {
    name: "excel",
    description: "Submit a deterministic Excel job spec from JSON arguments.",
    acceptsArgs: true,
    handler: (ctx: PluginCommandContext) => {
      const args = parseJsonArgs<ExcelCommandArgs>(ctx);
      if (!args) {
        return invalidJsonReply("excel");
      }

      switch (args.operation) {
        case "inspect": {
          if (!args.artifactIds?.length) {
            return missingJsonReply(
              "excel",
              '{"operation":"inspect","artifactIds":["artifact-id"]}'
            );
          }
          const response = submitOfficeInspect(toToolContext(ctx), {
            artifactIds: args.artifactIds,
            inspectMode: args.inspectMode,
            outputMode: args.outputMode
          });
          return toCommandReply(formatJobReply(response));
        }
        case "transform_excel": {
          if (!args.artifactId || !args.outputName) {
            return missingJsonReply(
              "excel",
              '{"operation":"transform_excel","artifactId":"artifact-id","outputName":"transformed.xlsx"}'
            );
          }
          const response = submitOfficeTransform(toToolContext(ctx), {
            artifactId: args.artifactId,
            outputName: args.outputName,
            sheetMode: args.sheetMode,
            sheetName: args.sheetName,
            selectColumns: args.selectColumns,
            renameColumns: args.renameColumns
          });
          return toCommandReply(formatJobReply(response));
        }
        case "merge_excel": {
          if (!args.artifactIds?.length || !args.mode || !args.outputName) {
            return missingJsonReply(
              "excel",
              '{"operation":"merge_excel","artifactIds":["a1","a2"],"mode":"by_header_union","outputName":"merged.xlsx"}'
            );
          }
          const response = submitOfficeMergeExcel(toToolContext(ctx), {
            artifactIds: args.artifactIds,
            mode: args.mode,
            outputName: args.outputName,
            sheetPolicy: args.sheetPolicy,
            sheetName: args.sheetName,
            dedupeKeys: args.dedupeKeys
          });
          return toCommandReply(formatJobReply(response));
        }
        case "extract_tables": {
          if (!args.artifactId || !args.format || !args.outputName) {
            return missingJsonReply(
              "excel",
              '{"operation":"extract_tables","artifactId":"artifact-id","format":"json","outputName":"tables.json"}'
            );
          }
          const response = submitOfficeExtractTables(toToolContext(ctx), {
            artifactId: args.artifactId,
            format: args.format as OfficeExtractTablesParams["format"],
            outputName: args.outputName
          });
          return toCommandReply(formatJobReply(response));
        }
        case "preview": {
          if (!args.artifactId || !args.format || !args.outputName) {
            return missingJsonReply(
              "excel",
              '{"operation":"preview","artifactId":"artifact-id","format":"pdf","outputName":"preview.pdf"}'
            );
          }
          const response = submitOfficePreview(toToolContext(ctx), {
            artifactId: args.artifactId,
            format: args.format as OfficePreviewParams["format"],
            outputName: args.outputName
          });
          return toCommandReply(formatJobReply(response));
        }
        default:
          return toCommandReply(`Unsupported /excel operation: ${args.operation}`, true);
      }
    }
  };
}

export function createWordCommand() {
  return {
    name: "word",
    description: "Submit a deterministic Word job spec from JSON arguments.",
    acceptsArgs: true,
    handler: (ctx: PluginCommandContext) => {
      const args = parseJsonArgs<WordCommandArgs>(ctx);
      if (!args) {
        return invalidJsonReply("word");
      }
      if (!args.templateArtifactId || !args.outputName) {
        return missingJsonReply(
          "word",
          '{"templateArtifactId":"template-id","variables":{"client_name":"Acme"},"outputName":"proposal.docx"}'
        );
      }

      const response = submitOfficeFillDocx(toToolContext(ctx), {
        templateArtifactId: args.templateArtifactId,
        variables: args.variables,
        outputName: args.outputName,
        strictVariables: args.strictVariables
      });
      return toCommandReply(formatJobReply(response));
    }
  };
}

export function createPptCommand() {
  return {
    name: "ppt",
    description: "Submit a deterministic PowerPoint job spec from JSON arguments.",
    acceptsArgs: true,
    handler: (ctx: PluginCommandContext) => {
      const args = parseJsonArgs<PptCommandArgs>(ctx);
      if (!args) {
        return invalidJsonReply("ppt");
      }
      if (!args.source || !args.theme || !args.outputName) {
        return missingJsonReply(
          "ppt",
          '{"source":{"kind":"outline","title":"Q2 Review"},"theme":"corporate_clean","outputName":"q2-review.pptx"}'
        );
      }

      const response = submitOfficeBuildPptx(toToolContext(ctx), {
        source: args.source,
        theme: args.theme,
        outputName: args.outputName,
        speakerNotes: args.speakerNotes
      });
      return toCommandReply(formatJobReply(response));
    }
  };
}

export const officeToolNames = [...OFFICE_TOOL_NAMES];
export const officeCommandNames = [...OFFICE_COMMAND_NAMES];

export default definePluginEntry({
  id: "jarvis-office",
  name: "Jarvis Office",
  description: "Office job broker for Word, Excel, and PowerPoint",
  register(api) {
    api.registerTool((ctx) => createOfficeTools(ctx));
    api.registerCommand(createExcelCommand());
    api.registerCommand(createWordCommand());
    api.registerCommand(createPptCommand());
    api.registerCommand(createOfficeStatusCommand());
  }
});
