import { randomUUID } from "node:crypto";
import type { OfficeAdapter, ExecutionOutcome } from "./adapter.js";
import { OfficeWorkerError } from "./adapter.js";
import type {
  OfficeInspectInput, OfficeInspectOutput,
  OfficeMergeExcelInput, OfficeMergeExcelOutput,
  OfficeTransformExcelInput, OfficeTransformExcelOutput,
  OfficeFillDocxInput, OfficeFillDocxOutput,
  OfficeBuildPptxInput, OfficeBuildPptxOutput,
  OfficeExtractTablesInput, OfficeExtractTablesOutput,
  OfficePreviewInput, OfficePreviewOutput
} from "./types.js";

export const MOCK_NOW = "2026-04-04T12:00:00.000Z";

export class MockOfficeAdapter implements OfficeAdapter {
  private inspectCalls: OfficeInspectInput[] = [];
  private mergeCalls: OfficeMergeExcelInput[] = [];
  private transformCalls: OfficeTransformExcelInput[] = [];
  private fillDocxCalls: OfficeFillDocxInput[] = [];
  private buildPptxCalls: OfficeBuildPptxInput[] = [];
  private extractTablesCalls: OfficeExtractTablesInput[] = [];
  private previewCalls: OfficePreviewInput[] = [];

  getInspectCalls(): OfficeInspectInput[] { return [...this.inspectCalls]; }
  getMergeCalls(): OfficeMergeExcelInput[] { return [...this.mergeCalls]; }
  getTransformCalls(): OfficeTransformExcelInput[] { return [...this.transformCalls]; }
  getFillDocxCalls(): OfficeFillDocxInput[] { return [...this.fillDocxCalls]; }
  getBuildPptxCalls(): OfficeBuildPptxInput[] { return [...this.buildPptxCalls]; }
  getExtractTablesCalls(): OfficeExtractTablesInput[] { return [...this.extractTablesCalls]; }
  getPreviewCalls(): OfficePreviewInput[] { return [...this.previewCalls]; }

  async inspect(input: OfficeInspectInput): Promise<ExecutionOutcome<OfficeInspectOutput>> {
    this.inspectCalls.push(input);

    const files = input.target_artifacts.map((a, i) => ({
      artifact_id: a.artifact_id,
      file_path: input.file_paths?.[i] ?? `/tmp/${a.artifact_id}.xlsx`,
      file_type: "xlsx" as const,
      size_bytes: 24576,
      sheet_count: 3,
      sheet_names: ["Sheet1", "Sheet2", "Summary"],
      row_count: 150,
      column_count: 8,
      last_modified: MOCK_NOW,
    }));

    return {
      summary: `Inspected ${files.length} file(s).`,
      structured_output: {
        files,
        inspected_at: MOCK_NOW,
      },
    };
  }

  async mergeExcel(input: OfficeMergeExcelInput): Promise<ExecutionOutcome<OfficeMergeExcelOutput>> {
    this.mergeCalls.push(input);

    return {
      summary: `Merged ${input.files.length} files into ${input.output_name}.`,
      structured_output: {
        output_path: `/tmp/jarvis-office/${input.output_name}`,
        output_name: input.output_name,
        sheets_merged: input.files.length * 2,
        total_rows: 420,
        duplicates_removed: input.dedupe.enabled ? 15 : 0,
        merged_at: MOCK_NOW,
      },
    };
  }

  async transformExcel(input: OfficeTransformExcelInput): Promise<ExecutionOutcome<OfficeTransformExcelOutput>> {
    this.transformCalls.push(input);

    return {
      summary: `Transformed Excel to ${input.output_name}.`,
      structured_output: {
        output_path: `/tmp/jarvis-office/${input.output_name}`,
        output_name: input.output_name,
        sheets_processed: input.sheet_mode === "all_sheets" ? 3 : 1,
        rows_before: 200,
        rows_after: 180,
        columns_renamed: Object.keys(input.rename_columns ?? {}).length,
        columns_selected: input.select_columns?.length ?? 0,
        transformed_at: MOCK_NOW,
      },
    };
  }

  async fillDocx(input: OfficeFillDocxInput): Promise<ExecutionOutcome<OfficeFillDocxOutput>> {
    this.fillDocxCalls.push(input);

    return {
      summary: `Filled DOCX template with ${Object.keys(input.variables).length} variable(s).`,
      structured_output: {
        output_path: `/tmp/jarvis-office/${input.output_name}`,
        output_name: input.output_name,
        variables_filled: Object.keys(input.variables).length,
        missing_variables: [],
        filled_at: MOCK_NOW,
      },
    };
  }

  async buildPptx(input: OfficeBuildPptxInput): Promise<ExecutionOutcome<OfficeBuildPptxOutput>> {
    this.buildPptxCalls.push(input);

    const source = input.source as { slides?: unknown[]; sections?: unknown[] };
    const slideCount = source.slides?.length ?? source.sections?.length ?? 1;

    return {
      summary: `Built PowerPoint: ${slideCount} slide(s), theme=${input.theme}.`,
      structured_output: {
        output_path: `/tmp/jarvis-office/${input.output_name}`,
        output_name: input.output_name,
        slide_count: slideCount,
        theme: input.theme,
        has_speaker_notes: input.speaker_notes,
        built_at: MOCK_NOW,
      },
    };
  }

  async extractTables(input: OfficeExtractTablesInput): Promise<ExecutionOutcome<OfficeExtractTablesOutput>> {
    this.extractTablesCalls.push(input);

    const tables = [
      {
        sheet_name: "Sheet1",
        table_index: 0,
        headers: ["Name", "Value", "Date"],
        rows: [
          ["Item A", 100, "2026-01-15"],
          ["Item B", 250, "2026-02-20"],
          ["Item C", 75, "2026-03-10"],
        ] as unknown[][],
        row_count: 3,
        column_count: 3,
      }
    ];

    return {
      summary: `Extracted ${tables.length} table(s), ${tables[0]!.row_count} total rows.`,
      structured_output: {
        output_path: `/tmp/jarvis-office/${input.output_name}`,
        output_name: input.output_name,
        format: input.format,
        tables,
        total_tables: tables.length,
        total_rows: tables[0]!.row_count,
        extracted_at: MOCK_NOW,
      },
    };
  }

  async preview(input: OfficePreviewInput): Promise<ExecutionOutcome<OfficePreviewOutput>> {
    this.previewCalls.push(input);

    return {
      summary: `Preview generated for ${input.source_artifact.artifact_id}.`,
      structured_output: {
        output_path: `/tmp/jarvis-office/${input.output_name}`,
        output_name: input.output_name,
        format: input.format === "text" || input.format === "html" ? input.format : "text",
        content: "Name\tValue\tDate\nItem A\t100\t2026-01-15\nItem B\t250\t2026-02-20",
        row_count: 2,
        truncated: false,
        previewed_at: MOCK_NOW,
      },
    };
  }
}

export function createMockOfficeAdapter(): OfficeAdapter {
  return new MockOfficeAdapter();
}
