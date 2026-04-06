import type { OpenClawPluginToolContext } from "openclaw/plugin-sdk/plugin-entry";
import { getJarvisState } from "./state.js";
import type { ToolResponse } from "./types.js";

export type OfficeInspectParams = {
  artifactIds: string[];
  inspectMode?: "auto" | "excel" | "word" | "powerpoint";
  outputMode?: "summary" | "json";
};

export type OfficeTransformParams = {
  artifactId: string;
  outputName: string;
  sheetMode?: "first_sheet" | "named_sheet" | "all_sheets";
  sheetName?: string;
  selectColumns?: string[];
  renameColumns?: Record<string, string>;
};

export type OfficeMergeExcelParams = {
  artifactIds: string[];
  mode: "by_header_union" | "append_rows_by_sheet" | "by_sheet_name";
  outputName: string;
  sheetPolicy?: "first_sheet" | "all_sheets" | "named_sheet";
  sheetName?: string;
  dedupeKeys?: string[];
};

export type OfficeFillDocxParams = {
  templateArtifactId: string;
  variables: Record<string, unknown>;
  outputName: string;
  strictVariables?: boolean;
};

export type OfficeBuildPptxParams = {
  source: Record<string, unknown>;
  theme: "corporate_clean" | "minimal_light" | "minimal_dark" | "executive_brief";
  outputName: string;
  speakerNotes?: boolean;
};

export type OfficeExtractTablesParams = {
  artifactId: string;
  format: "json" | "csv" | "xlsx";
  outputName: string;
};

export type OfficePreviewParams = {
  artifactId: string;
  format: "png" | "pdf" | "html" | "text";
  outputName: string;
};

export function submitOfficeInspect(
  ctx: OpenClawPluginToolContext | undefined,
  params: OfficeInspectParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "office.inspect",
    input: {
      target_artifacts: params.artifactIds.map((artifactId) => ({ artifact_id: artifactId })),
      inspect_mode: params.inspectMode ?? "auto",
      output_mode: params.outputMode ?? "summary"
    },
    artifactsIn: params.artifactIds.map((artifactId) => ({ artifact_id: artifactId }))
  });
}

export function submitOfficeTransform(
  ctx: OpenClawPluginToolContext | undefined,
  params: OfficeTransformParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "office.transform_excel",
    input: {
      source_artifact: { artifact_id: params.artifactId },
      output_name: params.outputName,
      sheet_mode: params.sheetMode ?? "first_sheet",
      sheet_name: params.sheetName,
      select_columns: params.selectColumns,
      rename_columns: params.renameColumns
    },
    artifactsIn: [{ artifact_id: params.artifactId }]
  });
}

export function submitOfficeMergeExcel(
  ctx: OpenClawPluginToolContext | undefined,
  params: OfficeMergeExcelParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "office.merge_excel",
    input: {
      files: params.artifactIds.map((artifactId) => ({ artifact_id: artifactId })),
      mode: params.mode,
      sheet_policy: params.sheetPolicy ?? "first_sheet",
      sheet_name: params.sheetName,
      dedupe: {
        enabled: Boolean(params.dedupeKeys?.length),
        keys: params.dedupeKeys
      },
      output_name: params.outputName
    },
    artifactsIn: params.artifactIds.map((artifactId) => ({ artifact_id: artifactId }))
  });
}

export function submitOfficeFillDocx(
  ctx: OpenClawPluginToolContext | undefined,
  params: OfficeFillDocxParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "office.fill_docx",
    input: {
      template_artifact_id: params.templateArtifactId,
      variables: params.variables,
      strict_variables: params.strictVariables ?? false,
      output_name: params.outputName
    },
    artifactsIn: [{ artifact_id: params.templateArtifactId }]
  });
}

export function submitOfficeBuildPptx(
  ctx: OpenClawPluginToolContext | undefined,
  params: OfficeBuildPptxParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "office.build_pptx",
    input: {
      source: params.source,
      theme: params.theme,
      speaker_notes: params.speakerNotes ?? false,
      output_name: params.outputName
    }
  });
}

export function submitOfficeExtractTables(
  ctx: OpenClawPluginToolContext | undefined,
  params: OfficeExtractTablesParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "office.extract_tables",
    input: {
      source_artifact: { artifact_id: params.artifactId },
      format: params.format,
      output_name: params.outputName
    },
    artifactsIn: [{ artifact_id: params.artifactId }]
  });
}

export function submitOfficePreview(
  ctx: OpenClawPluginToolContext | undefined,
  params: OfficePreviewParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "office.preview",
    input: {
      source_artifact: { artifact_id: params.artifactId },
      format: params.format,
      output_name: params.outputName
    },
    artifactsIn: [{ artifact_id: params.artifactId }]
  });
}
