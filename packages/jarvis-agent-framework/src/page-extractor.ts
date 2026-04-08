/**
 * Document page extraction service.
 *
 * Extracts per-page text from supported document files and produces
 * page metadata for downstream processing.
 *
 * For PDFs, this service reads the existing text layer only.  Pages with
 * missing or very thin text are flagged via `needsVision` and warnings
 * so callers can route scanned or image-based documents to OCR using a
 * separate vision processor.
 */

import fs from "node:fs";
import { extname } from "node:path";

// ─── Types ──────────────────────────────────────────────────────────────────

export type PageContent = {
  pageNumber: number;
  text: string;
  hasTextLayer: boolean;
  imagePath?: string;
};

export type PageExtractionResult = {
  filePath: string;
  fileType: string;
  totalPages: number;
  pages: PageContent[];
  needsVision: boolean;
  warnings: string[];
};

// ─── PageExtractor ──────────────────────────────────────────────────────────

export class PageExtractor {
  /**
   * Extract per-page content from a document file.
   *
   * For PDFs: uses pdf-parse to get text per page.  Flags pages with
   * empty or very thin text layers as needing vision/OCR processing.
   *
   * For DOCX/TXT: returns a single "page" with the full text content.
   */
  async extract(filePath: string, opts?: { maxPages?: number }): Promise<PageExtractionResult> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const ext = extname(filePath).toLowerCase();
    const maxPages = opts?.maxPages;

    if (ext === ".pdf") {
      return this.extractPdf(filePath, maxPages);
    }

    // Non-PDF: single page with full content
    let text: string;
    if (ext === ".docx") {
      const mammoth = (await import(/* webpackIgnore: true */ "mammoth" as string)) as {
        extractRawText: (opts: { path: string }) => Promise<{ value: string }>;
      };
      const result = await mammoth.extractRawText({ path: filePath });
      text = result.value;
    } else {
      text = fs.readFileSync(filePath, "utf8");
    }

    return {
      filePath,
      fileType: resolveType(ext),
      totalPages: 1,
      pages: [{ pageNumber: 1, text, hasTextLayer: true }],
      needsVision: false,
      warnings: [],
    };
  }

  private async extractPdf(
    filePath: string,
    maxPages?: number,
  ): Promise<PageExtractionResult> {
    const pdfParse = (
      await import(/* webpackIgnore: true */ "pdf-parse" as string)
    ).default as (
      buf: Buffer,
      opts?: Record<string, unknown>,
    ) => Promise<{ text: string; numpages: number }>;

    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer, { max: maxPages });

    // Split text by form-feed characters (page breaks in pdf-parse output)
    const rawPages = data.text.split("\f").filter((_, i) =>
      maxPages ? i < maxPages : true,
    );

    const pages: PageContent[] = [];
    const warnings: string[] = [];
    let needsVision = false;

    for (let i = 0; i < rawPages.length; i++) {
      const text = (rawPages[i] ?? "").trim();
      const hasTextLayer = text.length > 20;

      if (!hasTextLayer) {
        needsVision = true;
        warnings.push(`Page ${i + 1}: thin or missing text layer — OCR recommended`);
      }

      pages.push({
        pageNumber: i + 1,
        text,
        hasTextLayer,
      });
    }

    return {
      filePath,
      fileType: "pdf",
      totalPages: data.numpages,
      pages,
      needsVision,
      warnings,
    };
  }
}

function resolveType(ext: string): string {
  switch (ext) {
    case ".pdf": return "pdf";
    case ".docx": return "docx";
    case ".doc": return "doc";
    case ".txt": return "txt";
    case ".md": return "markdown";
    default: return "unknown";
  }
}
