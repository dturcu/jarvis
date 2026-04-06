import fs from "node:fs";
import path from "node:path";
import type { OfficeAdapter, ExecutionOutcome } from "./adapter.js";
import { OfficeWorkerError } from "./adapter.js";
import type {
  OfficeInspectInput, OfficeInspectOutput, OfficeFileInfo,
  OfficeMergeExcelInput, OfficeMergeExcelOutput,
  OfficeTransformExcelInput, OfficeTransformExcelOutput,
  OfficeFillDocxInput, OfficeFillDocxOutput,
  OfficeBuildPptxInput, OfficeBuildPptxOutput,
  OfficeExtractTablesInput, OfficeExtractTablesOutput, ExtractedTable,
  OfficePreviewInput, OfficePreviewOutput,
  PptxSource, SlideDefinition
} from "./types.js";

export type RealOfficeAdapterOptions = {
  /** Directory where output files are written. Defaults to os temp dir. */
  outputDir?: string;
};

/**
 * Real office adapter using xlsx, docxtemplater+pizzip, and pptxgenjs.
 */
export class RealOfficeAdapter implements OfficeAdapter {
  private readonly outputDir: string;

  constructor(options: RealOfficeAdapterOptions = {}) {
    this.outputDir = options.outputDir ?? path.join(process.env["TEMP"] ?? process.env["TMPDIR"] ?? "/tmp", "jarvis-office");
    fs.mkdirSync(this.outputDir, { recursive: true });
  }

  // ── inspect ─────────────────────────────────────────────────────────────────

  async inspect(input: OfficeInspectInput): Promise<ExecutionOutcome<OfficeInspectOutput>> {
    const filePaths = input.file_paths ?? [];
    if (filePaths.length === 0) {
      throw new OfficeWorkerError("INVALID_INPUT", "No file_paths provided for inspect.", false);
    }

    const XLSX = await importXlsx();
    const files: OfficeFileInfo[] = [];

    for (let i = 0; i < filePaths.length; i++) {
      const filePath = filePaths[i]!;
      const artifactId = input.target_artifacts[i]?.artifact_id ?? `artifact-${i}`;

      if (!fs.existsSync(filePath)) {
        throw new OfficeWorkerError("FILE_NOT_FOUND", `File not found: ${filePath}`, false, { file_path: filePath });
      }

      const stats = fs.statSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const fileType = resolveFileType(ext);

      const info: OfficeFileInfo = {
        artifact_id: artifactId,
        file_path: filePath,
        file_type: fileType,
        size_bytes: stats.size,
        last_modified: stats.mtime.toISOString(),
      };

      if (fileType === "xlsx" || fileType === "xls" || fileType === "csv") {
        try {
          const wb = XLSX.readFile(filePath);
          info.sheet_count = wb.SheetNames.length;
          info.sheet_names = wb.SheetNames;

          // Count rows/columns from first sheet
          const firstSheet = wb.Sheets[wb.SheetNames[0]!];
          if (firstSheet) {
            const range = XLSX.utils.decode_range((firstSheet as Record<string, string>)["!ref"] ?? "A1");
            info.row_count = range.e.r - range.s.r + 1;
            info.column_count = range.e.c - range.s.c + 1;
          }
        } catch {
          // If parsing fails, we still return basic file info
        }
      }

      files.push(info);
    }

    return {
      summary: `Inspected ${files.length} file(s): ${files.map(f => `${f.file_type}(${formatBytes(f.size_bytes)})`).join(", ")}.`,
      structured_output: {
        files,
        inspected_at: new Date().toISOString(),
      },
    };
  }

  // ── mergeExcel ──────────────────────────────────────────────────────────────

  async mergeExcel(input: OfficeMergeExcelInput): Promise<ExecutionOutcome<OfficeMergeExcelOutput>> {
    const filePaths = input.file_paths ?? [];
    if (filePaths.length < 2) {
      throw new OfficeWorkerError("INVALID_INPUT", "At least 2 file_paths are required to merge.", false);
    }

    const XLSX = await importXlsx();
    const outputWb = XLSX.utils.book_new();
    let totalRows = 0;
    let duplicatesRemoved = 0;
    let sheetsMerged = 0;

    if (input.mode === "by_header_union" || input.mode === "append_rows_by_sheet") {
      // Combine rows from all files into a single sheet
      const allRows: Record<string, unknown>[] = [];
      const sheetName = input.sheet_name ?? "Merged";

      for (const filePath of filePaths) {
        assertFileExists(filePath);
        const wb = XLSX.readFile(filePath);
        const sheets = resolveSheets(wb, input.sheet_policy, input.sheet_name);

        for (const sn of sheets) {
          const ws = wb.Sheets[sn];
          if (!ws) continue;
          const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);
          allRows.push(...rows);
          sheetsMerged++;
        }
      }

      // Deduplicate if requested
      if (input.dedupe.enabled && input.dedupe.keys?.length) {
        const seen = new Set<string>();
        const deduped: Record<string, unknown>[] = [];
        for (const row of allRows) {
          const key = input.dedupe.keys.map(k => String(row[k] ?? "")).join("|");
          if (!seen.has(key)) {
            seen.add(key);
            deduped.push(row);
          } else {
            duplicatesRemoved++;
          }
        }
        totalRows = deduped.length;
        const ws = XLSX.utils.json_to_sheet(deduped);
        XLSX.utils.book_append_sheet(outputWb, ws, sheetName);
      } else {
        totalRows = allRows.length;
        const ws = XLSX.utils.json_to_sheet(allRows);
        XLSX.utils.book_append_sheet(outputWb, ws, sheetName);
      }
    } else if (input.mode === "by_sheet_name") {
      // Each file's sheets go into the output workbook by sheet name
      const sheetData = new Map<string, Record<string, unknown>[]>();

      for (const filePath of filePaths) {
        assertFileExists(filePath);
        const wb = XLSX.readFile(filePath);
        const sheets = resolveSheets(wb, input.sheet_policy, input.sheet_name);

        for (const sn of sheets) {
          const ws = wb.Sheets[sn];
          if (!ws) continue;
          const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);
          const existing = sheetData.get(sn) ?? [];
          existing.push(...rows);
          sheetData.set(sn, existing);
          sheetsMerged++;
        }
      }

      for (const [sn, rows] of sheetData) {
        totalRows += rows.length;
        const ws = XLSX.utils.json_to_sheet(rows);
        XLSX.utils.book_append_sheet(outputWb, ws, sn.slice(0, 31));
      }
    }

    const outputPath = path.join(this.outputDir, input.output_name);
    XLSX.writeFile(outputWb, outputPath);

    return {
      summary: `Merged ${filePaths.length} files (${sheetsMerged} sheets, ${totalRows} rows${duplicatesRemoved > 0 ? `, ${duplicatesRemoved} duplicates removed` : ""}).`,
      structured_output: {
        output_path: outputPath,
        output_name: input.output_name,
        sheets_merged: sheetsMerged,
        total_rows: totalRows,
        duplicates_removed: duplicatesRemoved,
        merged_at: new Date().toISOString(),
      },
    };
  }

  // ── transformExcel ──────────────────────────────────────────────────────────

  async transformExcel(input: OfficeTransformExcelInput): Promise<ExecutionOutcome<OfficeTransformExcelOutput>> {
    const filePath = input.file_path;
    if (!filePath) {
      throw new OfficeWorkerError("INVALID_INPUT", "No file_path provided for transform.", false);
    }
    assertFileExists(filePath);

    const XLSX = await importXlsx();
    const wb = XLSX.readFile(filePath);
    const sheets = resolveSheets(wb, input.sheet_mode, input.sheet_name);

    const outputWb = XLSX.utils.book_new();
    let rowsBefore = 0;
    let rowsAfter = 0;
    let columnsRenamed = 0;
    let columnsSelected = 0;

    for (const sheetName of sheets) {
      const ws = wb.Sheets[sheetName];
      if (!ws) continue;

      let rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);
      rowsBefore += rows.length;

      // Filter rows if specified
      if (input.filter_rows && Object.keys(input.filter_rows).length > 0) {
        rows = rows.filter(row => {
          return Object.entries(input.filter_rows!).every(([key, value]) => {
            const cellValue = row[key];
            if (value === null || value === undefined) return cellValue === null || cellValue === undefined;
            return String(cellValue) === String(value);
          });
        });
      }

      // Select columns
      if (input.select_columns?.length) {
        columnsSelected += input.select_columns.length;
        rows = rows.map(row => {
          const filtered: Record<string, unknown> = {};
          for (const col of input.select_columns!) {
            if (col in row) {
              filtered[col] = row[col];
            }
          }
          return filtered;
        });
      }

      // Rename columns
      if (input.rename_columns && Object.keys(input.rename_columns).length > 0) {
        const renames = input.rename_columns;
        columnsRenamed += Object.keys(renames).length;
        rows = rows.map(row => {
          const renamed: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(row)) {
            const newKey = renames[key] ?? key;
            renamed[newKey] = value;
          }
          return renamed;
        });
      }

      // Apply formulas (as computed columns)
      if (input.formulas && Object.keys(input.formulas).length > 0) {
        for (const [colName, formula] of Object.entries(input.formulas)) {
          for (const row of rows) {
            try {
              row[colName] = evaluateSimpleFormula(formula, row);
            } catch {
              row[colName] = "#ERROR";
            }
          }
        }
      }

      rowsAfter += rows.length;
      const newWs = XLSX.utils.json_to_sheet(rows);
      XLSX.utils.book_append_sheet(outputWb, newWs, sheetName.slice(0, 31));
    }

    const outputPath = path.join(this.outputDir, input.output_name);
    XLSX.writeFile(outputWb, outputPath);

    return {
      summary: `Transformed Excel: ${sheets.length} sheet(s), ${rowsBefore} -> ${rowsAfter} rows.`,
      structured_output: {
        output_path: outputPath,
        output_name: input.output_name,
        sheets_processed: sheets.length,
        rows_before: rowsBefore,
        rows_after: rowsAfter,
        columns_renamed: columnsRenamed,
        columns_selected: columnsSelected,
        transformed_at: new Date().toISOString(),
      },
    };
  }

  // ── fillDocx ────────────────────────────────────────────────────────────────

  async fillDocx(input: OfficeFillDocxInput): Promise<ExecutionOutcome<OfficeFillDocxOutput>> {
    const filePath = input.file_path;
    if (!filePath) {
      throw new OfficeWorkerError("INVALID_INPUT", "No file_path provided for DOCX template.", false);
    }
    assertFileExists(filePath);

    const PizZip = (await import(/* webpackIgnore: true */ "pizzip" as string)).default as new (data: Buffer) => PizZipInstance;
    const Docxtemplater = (await import(/* webpackIgnore: true */ "docxtemplater" as string)).default as new (zip: PizZipInstance, opts?: Record<string, unknown>) => DocxtemplaterInstance;

    const content = fs.readFileSync(filePath);
    const zip = new PizZip(content);

    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      ...(input.strict_variables ? {} : { nullGetter: () => "" }),
    });

    // Determine which variables are in the template vs provided
    const missingVariables: string[] = [];
    try {
      doc.render(input.variables);
    } catch (error: unknown) {
      if (input.strict_variables) {
        const err = error as { properties?: { errors?: Array<{ properties?: { id?: string } }> } };
        const errors = err.properties?.errors ?? [];
        for (const e of errors) {
          const id = e.properties?.id;
          if (id) missingVariables.push(id);
        }
        if (missingVariables.length > 0) {
          throw new OfficeWorkerError(
            "TEMPLATE_VARIABLE_MISSING",
            `Missing template variables: ${missingVariables.join(", ")}`,
            false,
            { missing_variables: missingVariables }
          );
        }
      }
      throw error;
    }

    const buf = doc.getZip().generate({ type: "nodebuffer" }) as Buffer;
    const outputPath = path.join(this.outputDir, input.output_name);
    fs.writeFileSync(outputPath, buf);

    const variablesFilled = Object.keys(input.variables).length;

    return {
      summary: `Filled DOCX template with ${variablesFilled} variable(s).`,
      structured_output: {
        output_path: outputPath,
        output_name: input.output_name,
        variables_filled: variablesFilled,
        missing_variables: missingVariables,
        filled_at: new Date().toISOString(),
      },
    };
  }

  // ── buildPptx ───────────────────────────────────────────────────────────────

  async buildPptx(input: OfficeBuildPptxInput): Promise<ExecutionOutcome<OfficeBuildPptxOutput>> {
    const PptxGenJS = (await import(/* webpackIgnore: true */ "pptxgenjs" as string)).default as new () => PptxGenInstance;
    const pptx = new PptxGenJS();

    const source = input.source as PptxSource;
    const themeColors = getThemeColors(input.theme);

    pptx.layout = "LAYOUT_WIDE";
    if (source.title) {
      pptx.title = source.title;
    }

    const slides: SlideDefinition[] = [];

    // Build slides from source
    if (source.slides?.length) {
      slides.push(...source.slides);
    } else if (source.sections?.length) {
      // Title slide
      if (source.title) {
        slides.push({
          title: source.title,
          subtitle: source.subtitle,
          layout: "title",
        });
      }
      // Section slides
      for (const section of source.sections) {
        slides.push({
          title: section.heading,
          body: section.bullets,
          layout: "content",
        });
      }
    } else {
      // Fallback: treat entire source as a single slide outline
      slides.push({
        title: source.title ?? "Presentation",
        subtitle: source.subtitle,
        layout: "title",
      });
    }

    let hasSpeakerNotes = false;

    for (const slideDef of slides) {
      const slide = pptx.addSlide();

      if (slideDef.title) {
        slide.addText(slideDef.title, {
          x: 0.5,
          y: slideDef.layout === "title" ? 2.0 : 0.3,
          w: "90%",
          fontSize: slideDef.layout === "title" ? 36 : 28,
          bold: true,
          color: themeColors.title,
        });
      }

      if (slideDef.subtitle) {
        slide.addText(slideDef.subtitle, {
          x: 0.5,
          y: slideDef.layout === "title" ? 3.2 : 1.2,
          w: "90%",
          fontSize: 18,
          color: themeColors.subtitle,
        });
      }

      if (slideDef.body) {
        const bodyText = Array.isArray(slideDef.body) ? slideDef.body.join("\n") : slideDef.body;
        slide.addText(bodyText, {
          x: 0.5,
          y: 1.8,
          w: "90%",
          h: 4.5,
          fontSize: 16,
          color: themeColors.body,
          valign: "top",
          bullet: Array.isArray(slideDef.body),
        });
      }

      if (input.speaker_notes && slideDef.notes) {
        slide.addNotes(slideDef.notes);
        hasSpeakerNotes = true;
      }
    }

    const outputPath = path.join(this.outputDir, input.output_name);
    await pptx.writeFile({ fileName: outputPath });

    return {
      summary: `Built PowerPoint: ${slides.length} slide(s), theme=${input.theme}.`,
      structured_output: {
        output_path: outputPath,
        output_name: input.output_name,
        slide_count: slides.length,
        theme: input.theme,
        has_speaker_notes: hasSpeakerNotes,
        built_at: new Date().toISOString(),
      },
    };
  }

  // ── extractTables ───────────────────────────────────────────────────────────

  async extractTables(input: OfficeExtractTablesInput): Promise<ExecutionOutcome<OfficeExtractTablesOutput>> {
    const filePath = input.file_path;
    if (!filePath) {
      throw new OfficeWorkerError("INVALID_INPUT", "No file_path provided for table extraction.", false);
    }
    assertFileExists(filePath);

    const XLSX = await importXlsx();
    const ext = path.extname(filePath).toLowerCase();
    const tables: ExtractedTable[] = [];
    let totalRows = 0;

    if (ext === ".xlsx" || ext === ".xls" || ext === ".csv") {
      const wb = XLSX.readFile(filePath);

      for (const sheetName of wb.SheetNames) {
        const ws = wb.Sheets[sheetName];
        if (!ws) continue;

        const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 });
        if (rows.length === 0) continue;

        const headerRow = rows[0] as unknown[];
        const headers = headerRow.map(h => String(h ?? ""));
        const dataRows = rows.slice(1) as unknown[][];

        tables.push({
          sheet_name: sheetName,
          table_index: tables.length,
          headers,
          rows: dataRows,
          row_count: dataRows.length,
          column_count: headers.length,
        });
        totalRows += dataRows.length;
      }
    } else if (ext === ".docx") {
      // For DOCX, extract tables using xlsx to parse any embedded tables
      // docx table extraction is limited; we read the file as a zip and look for table XML
      throw new OfficeWorkerError(
        "UNSUPPORTED_FORMAT",
        "DOCX table extraction requires specialized parsing. Use office.inspect to view the document first.",
        false,
        { file_path: filePath, extension: ext }
      );
    } else {
      throw new OfficeWorkerError(
        "UNSUPPORTED_FORMAT",
        `Cannot extract tables from ${ext} files.`,
        false,
        { file_path: filePath, extension: ext }
      );
    }

    // Write output in requested format
    const outputPath = path.join(this.outputDir, input.output_name);

    if (input.format === "json") {
      fs.writeFileSync(outputPath, JSON.stringify(tables, null, 2));
    } else if (input.format === "csv") {
      const csvLines: string[] = [];
      for (const table of tables) {
        if (table.sheet_name) csvLines.push(`# Sheet: ${table.sheet_name}`);
        csvLines.push(table.headers.map(escapeCsv).join(","));
        for (const row of table.rows) {
          csvLines.push(row.map(cell => escapeCsv(String(cell ?? ""))).join(","));
        }
        csvLines.push("");
      }
      fs.writeFileSync(outputPath, csvLines.join("\n"));
    } else if (input.format === "xlsx") {
      const outputWb = XLSX.utils.book_new();
      for (const table of tables) {
        const data = [table.headers, ...table.rows];
        const ws = XLSX.utils.aoa_to_sheet(data);
        XLSX.utils.book_append_sheet(outputWb, ws, (table.sheet_name ?? `Table_${table.table_index}`).slice(0, 31));
      }
      XLSX.writeFile(outputWb, outputPath);
    }

    return {
      summary: `Extracted ${tables.length} table(s), ${totalRows} total rows.`,
      structured_output: {
        output_path: outputPath,
        output_name: input.output_name,
        format: input.format,
        tables,
        total_tables: tables.length,
        total_rows: totalRows,
        extracted_at: new Date().toISOString(),
      },
    };
  }

  // ── preview ─────────────────────────────────────────────────────────────────

  async preview(input: OfficePreviewInput): Promise<ExecutionOutcome<OfficePreviewOutput>> {
    const filePath = input.file_path;
    if (!filePath) {
      throw new OfficeWorkerError("INVALID_INPUT", "No file_path provided for preview.", false);
    }
    assertFileExists(filePath);

    const ext = path.extname(filePath).toLowerCase();
    const maxRows = input.max_rows ?? 50;
    let content = "";
    let rowCount: number | undefined;
    let truncated = false;

    if (ext === ".xlsx" || ext === ".xls" || ext === ".csv") {
      const XLSX = await importXlsx();
      const wb = XLSX.readFile(filePath);
      const firstSheet = wb.Sheets[wb.SheetNames[0]!];
      if (firstSheet) {
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet);
        rowCount = rows.length;
        const previewRows = rows.slice(0, maxRows);
        truncated = rows.length > maxRows;

        if (input.format === "text") {
          // Tab-separated text preview
          if (previewRows.length > 0) {
            const headers = Object.keys(previewRows[0]!);
            content = headers.join("\t") + "\n";
            for (const row of previewRows) {
              content += headers.map(h => String(row[h] ?? "")).join("\t") + "\n";
            }
          }
        } else {
          // HTML table preview
          if (previewRows.length > 0) {
            const headers = Object.keys(previewRows[0]!);
            content = "<table>\n<thead><tr>";
            for (const h of headers) content += `<th>${escapeHtml(h)}</th>`;
            content += "</tr></thead>\n<tbody>\n";
            for (const row of previewRows) {
              content += "<tr>";
              for (const h of headers) content += `<td>${escapeHtml(String(row[h] ?? ""))}</td>`;
              content += "</tr>\n";
            }
            content += "</tbody>\n</table>";
          }
        }
      }
    } else if (ext === ".docx") {
      // Read the raw text from a DOCX file for preview
      try {
        const mammoth = (await import(/* webpackIgnore: true */ "mammoth" as string)) as { extractRawText: (opts: { path: string }) => Promise<{ value: string }> };
        const result = await mammoth.extractRawText({ path: filePath });
        const lines = result.value.split("\n");
        const maxLines = maxRows * 2; // Use maxRows as a proxy for line count
        truncated = lines.length > maxLines;
        content = lines.slice(0, maxLines).join("\n");
      } catch {
        // Fallback: read raw file as text
        const raw = fs.readFileSync(filePath, "utf8").slice(0, 5000);
        content = raw;
        truncated = true;
      }
    } else {
      // Treat as text file
      const raw = fs.readFileSync(filePath, "utf8");
      const lines = raw.split("\n");
      const maxLines = maxRows * 2;
      truncated = lines.length > maxLines;
      content = lines.slice(0, maxLines).join("\n");
    }

    const outputPath = path.join(this.outputDir, input.output_name);
    fs.writeFileSync(outputPath, content);

    return {
      summary: `Preview generated: ${ext} file${truncated ? " (truncated)" : ""}.`,
      structured_output: {
        output_path: outputPath,
        output_name: input.output_name,
        format: input.format === "text" || input.format === "html" ? input.format : "text",
        content,
        row_count: rowCount,
        truncated,
        previewed_at: new Date().toISOString(),
      },
    };
  }
}

// ─── Private helpers ─────────────────────────────────────────────────────────

type XlsxLib = {
  readFile: (path: string) => XlsxWorkbook;
  writeFile: (wb: XlsxWorkbook, path: string) => void;
  utils: {
    book_new: () => XlsxWorkbook;
    book_append_sheet: (wb: XlsxWorkbook, ws: unknown, name: string) => void;
    json_to_sheet: (data: unknown[]) => unknown;
    sheet_to_json: <T>(ws: unknown, opts?: Record<string, unknown>) => T[];
    aoa_to_sheet: (data: unknown[][]) => unknown;
    decode_range: (ref: string) => { s: { r: number; c: number }; e: { r: number; c: number } };
  };
};

type XlsxWorkbook = {
  SheetNames: string[];
  Sheets: Record<string, unknown>;
};

type PizZipInstance = {
  generate: (opts: { type: string }) => Buffer;
};

type DocxtemplaterInstance = {
  render: (data: Record<string, unknown>) => void;
  getZip: () => PizZipInstance;
};

type PptxSlide = {
  addText: (text: string, opts: Record<string, unknown>) => void;
  addNotes: (notes: string) => void;
};

type PptxGenInstance = {
  layout: string;
  title: string;
  addSlide: () => PptxSlide;
  writeFile: (opts: { fileName: string }) => Promise<void>;
};

async function importXlsx(): Promise<XlsxLib> {
  return (await import(/* webpackIgnore: true */ "xlsx" as string)) as unknown as XlsxLib;
}

function resolveFileType(ext: string): OfficeFileInfo["file_type"] {
  switch (ext) {
    case ".xlsx": return "xlsx";
    case ".xls": return "xls";
    case ".csv": return "csv";
    case ".docx": return "docx";
    case ".pptx": return "pptx";
    default: return "unknown";
  }
}

function resolveSheets(
  wb: XlsxWorkbook,
  policy: "first_sheet" | "all_sheets" | "named_sheet" | undefined,
  sheetName: string | undefined,
): string[] {
  if (policy === "named_sheet" && sheetName) {
    if (!wb.SheetNames.includes(sheetName)) {
      throw new OfficeWorkerError(
        "SHEET_NOT_FOUND",
        `Sheet '${sheetName}' not found. Available: ${wb.SheetNames.join(", ")}`,
        false,
        { available_sheets: wb.SheetNames }
      );
    }
    return [sheetName];
  }
  if (policy === "all_sheets") {
    return wb.SheetNames;
  }
  // Default: first_sheet
  return wb.SheetNames.length > 0 ? [wb.SheetNames[0]!] : [];
}

function assertFileExists(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    throw new OfficeWorkerError("FILE_NOT_FOUND", `File not found: ${filePath}`, false, { file_path: filePath });
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function escapeCsv(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Evaluate a simple formula expression against a row.
 * Supports basic column references like {Column_A} + {Column_B}.
 */
function evaluateSimpleFormula(formula: string, row: Record<string, unknown>): unknown {
  let expr = formula;
  for (const [key, value] of Object.entries(row)) {
    const numVal = Number(value);
    const replacement = isNaN(numVal) ? `"${String(value ?? "")}"` : String(numVal);
    expr = expr.replace(new RegExp(`\\{${escapeRegex(key)}\\}`, "g"), replacement);
  }
  // Only evaluate if the result looks like a safe numeric expression
  if (/^[\d\s+\-*/().]+$/.test(expr)) {
    try {
      return new Function(`return (${expr})`)() as unknown;
    } catch {
      return "#ERROR";
    }
  }
  return expr;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getThemeColors(theme: string): { title: string; subtitle: string; body: string } {
  switch (theme) {
    case "corporate_clean":
      return { title: "003366", subtitle: "336699", body: "333333" };
    case "minimal_light":
      return { title: "222222", subtitle: "666666", body: "444444" };
    case "minimal_dark":
      return { title: "FFFFFF", subtitle: "CCCCCC", body: "DDDDDD" };
    case "executive_brief":
      return { title: "1A1A2E", subtitle: "16213E", body: "0F3460" };
    default:
      return { title: "000000", subtitle: "333333", body: "444444" };
  }
}
