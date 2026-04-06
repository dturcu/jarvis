// ── office.inspect ───────────────────────────────────────────────────────────

export type OfficeInspectInput = {
  target_artifacts: Array<{ artifact_id: string }>;
  inspect_mode: "auto" | "excel" | "word" | "powerpoint";
  output_mode: "summary" | "json";
  /** Resolved file paths corresponding to each artifact, injected by the worker. */
  file_paths?: string[];
};

export type OfficeFileInfo = {
  artifact_id: string;
  file_path: string;
  file_type: "xlsx" | "xls" | "docx" | "pptx" | "csv" | "unknown";
  size_bytes: number;
  sheet_count?: number;
  sheet_names?: string[];
  page_count?: number;
  slide_count?: number;
  row_count?: number;
  column_count?: number;
  last_modified?: string;
};

export type OfficeInspectOutput = {
  files: OfficeFileInfo[];
  inspected_at: string;
};

// ── office.merge_excel ──────────────────────────────────────────────────────

export type OfficeMergeExcelInput = {
  files: Array<{ artifact_id: string }>;
  mode: "by_header_union" | "append_rows_by_sheet" | "by_sheet_name";
  sheet_policy: "first_sheet" | "all_sheets" | "named_sheet";
  sheet_name?: string;
  dedupe: {
    enabled: boolean;
    keys?: string[];
  };
  output_name: string;
  /** Resolved file paths corresponding to each artifact, injected by the worker. */
  file_paths?: string[];
};

export type OfficeMergeExcelOutput = {
  output_path: string;
  output_name: string;
  sheets_merged: number;
  total_rows: number;
  duplicates_removed: number;
  merged_at: string;
};

// ── office.transform_excel ──────────────────────────────────────────────────

export type OfficeTransformExcelInput = {
  source_artifact: { artifact_id: string };
  output_name: string;
  sheet_mode: "first_sheet" | "named_sheet" | "all_sheets";
  sheet_name?: string;
  select_columns?: string[];
  rename_columns?: Record<string, string>;
  filter_rows?: Record<string, unknown>;
  formulas?: Record<string, string>;
  /** Resolved file path for the source artifact, injected by the worker. */
  file_path?: string;
};

export type OfficeTransformExcelOutput = {
  output_path: string;
  output_name: string;
  sheets_processed: number;
  rows_before: number;
  rows_after: number;
  columns_renamed: number;
  columns_selected: number;
  transformed_at: string;
};

// ── office.fill_docx ────────────────────────────────────────────────────────

export type OfficeFillDocxInput = {
  template_artifact_id: string;
  variables: Record<string, unknown>;
  strict_variables: boolean;
  output_name: string;
  /** Resolved file path for the template, injected by the worker. */
  file_path?: string;
};

export type OfficeFillDocxOutput = {
  output_path: string;
  output_name: string;
  variables_filled: number;
  missing_variables: string[];
  filled_at: string;
};

// ── office.build_pptx ───────────────────────────────────────────────────────

export type SlideDefinition = {
  title?: string;
  subtitle?: string;
  body?: string | string[];
  notes?: string;
  layout?: "title" | "section" | "content" | "two_column" | "blank";
  image_path?: string;
};

export type PptxSource = {
  kind?: "outline" | "slides";
  title?: string;
  subtitle?: string;
  slides?: SlideDefinition[];
  sections?: Array<{ heading: string; bullets: string[] }>;
};

export type OfficeBuildPptxInput = {
  source: Record<string, unknown>;
  theme: "corporate_clean" | "minimal_light" | "minimal_dark" | "executive_brief";
  speaker_notes: boolean;
  output_name: string;
};

export type OfficeBuildPptxOutput = {
  output_path: string;
  output_name: string;
  slide_count: number;
  theme: string;
  has_speaker_notes: boolean;
  built_at: string;
};

// ── office.extract_tables ───────────────────────────────────────────────────

export type OfficeExtractTablesInput = {
  source_artifact: { artifact_id: string };
  format: "json" | "csv" | "xlsx";
  output_name: string;
  /** Resolved file path for the source artifact, injected by the worker. */
  file_path?: string;
};

export type ExtractedTable = {
  sheet_name?: string;
  table_index: number;
  headers: string[];
  rows: unknown[][];
  row_count: number;
  column_count: number;
};

export type OfficeExtractTablesOutput = {
  output_path: string;
  output_name: string;
  format: "json" | "csv" | "xlsx";
  tables: ExtractedTable[];
  total_tables: number;
  total_rows: number;
  extracted_at: string;
};

// ── office.preview ──────────────────────────────────────────────────────────

export type OfficePreviewInput = {
  source_artifact: { artifact_id: string };
  format: "png" | "pdf" | "html" | "text";
  output_name: string;
  max_rows?: number;
  max_pages?: number;
  /** Resolved file path for the source artifact, injected by the worker. */
  file_path?: string;
};

export type OfficePreviewOutput = {
  output_path: string;
  output_name: string;
  format: "png" | "pdf" | "html" | "text";
  content?: string;
  row_count?: number;
  page_count?: number;
  truncated: boolean;
  previewed_at: string;
};
