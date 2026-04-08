import { readFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { extname } from "node:path";
import type { ChatFn } from "./hybrid-retriever.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type VisionProcessorConfig = {
  /** Chat completion function that supports vision — injected by the caller */
  visionChatFn: VisionChatFn;
  /** Max image file size in MB (default 10) */
  maxImageSizeMB?: number;
};

/**
 * Vision-capable chat function signature.
 *
 * Accepts multimodal messages (text + image_url content parts) and returns
 * a text response. Must be backed by a vision-capable model (llava, minicpm-v,
 * moondream, etc.) via Ollama or LM Studio.
 */
export type VisionChatFn = (params: {
  baseUrl: string;
  model: string;
  messages: Array<{
    role: string;
    content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
  }>;
  temperature?: number;
  maxTokens?: number;
}) => Promise<{ content: string }>;

export type VisionAnalysisResult = {
  description: string;
  extractedText?: string;
  structuredData?: Record<string, unknown>;
  confidence: number;
};

export type ComplianceMarker = {
  type: "signature" | "date" | "revision" | "stamp" | "approval" | "header" | "table" | "diagram";
  description: string;
  present: boolean;
  confidence: number;
};

export type OcrResult = {
  text: string;
  confidence: number;
};

// ─── MIME type inference ────────────────────────────────────────────────────

const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".tiff": "image/tiff",
  ".tif": "image/tiff",
};

function inferMime(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return MIME_MAP[ext] ?? "image/png";
}

// ─── VisionProcessor ────────────────────────────────────────────────────────

/**
 * Multimodal vision processor for document analysis.
 *
 * Converts local image/PDF page files to base64 data URIs and routes
 * them through a vision-capable LLM for:
 * - General image analysis (diagrams, architecture screenshots)
 * - OCR (scanned PDF pages, handwritten notes)
 * - Compliance marker detection (signatures, stamps, dates, tables)
 *
 * Integrates with the evidence-auditor, contract-reviewer, and
 * document plugin workflows.
 */
export class VisionProcessor {
  private visionChatFn: VisionChatFn;
  private maxImageBytes: number;

  constructor(config: VisionProcessorConfig) {
    this.visionChatFn = config.visionChatFn;
    this.maxImageBytes = (config.maxImageSizeMB ?? 10) * 1024 * 1024;
  }

  /**
   * Analyze a single image and return a structured description.
   *
   * @param imagePath - Absolute path to an image file
   * @param prompt - Analysis instructions (e.g. "Describe the architecture diagram")
   * @param baseUrl - Inference runtime base URL
   * @param model - Vision model ID
   */
  async analyzeImage(
    imagePath: string,
    prompt: string,
    baseUrl: string,
    model: string,
  ): Promise<VisionAnalysisResult> {
    const dataUri = await this.loadImageAsDataUri(imagePath);

    const result = await this.visionChatFn({
      baseUrl,
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: dataUri } },
          ],
        },
      ],
      temperature: 0.1,
      maxTokens: 1024,
    });

    return {
      description: result.content,
      confidence: 0.8,
    };
  }

  /**
   * Extract text from a scanned document page image via OCR.
   *
   * @param imagePath - Path to a page image (PNG/JPEG)
   * @param baseUrl - Inference runtime base URL
   * @param model - Vision model ID
   */
  async ocrPage(
    imagePath: string,
    baseUrl: string,
    model: string,
  ): Promise<OcrResult> {
    const dataUri = await this.loadImageAsDataUri(imagePath);

    const result = await this.visionChatFn({
      baseUrl,
      model,
      messages: [
        {
          role: "system",
          content:
            "You are an OCR system. Extract ALL text visible in the image exactly as it appears. " +
            "Preserve formatting, headings, bullet points, and table structure. " +
            "Output ONLY the extracted text, nothing else.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Extract all text from this document page." },
            { type: "image_url", image_url: { url: dataUri } },
          ],
        },
      ],
      temperature: 0,
      maxTokens: 4096,
    });

    return {
      text: result.content,
      confidence: 0.7,
    };
  }

  /**
   * Analyze a document page for compliance markers.
   *
   * Detects: signatures, dates, revision marks, stamps, approval blocks,
   * headers, tables, and diagrams. Used by the evidence-auditor to validate
   * ISO 26262 work product completeness.
   *
   * @param imagePath - Path to a page image
   * @param baseUrl - Inference runtime base URL
   * @param model - Vision model ID
   */
  async analyzeComplianceMarkers(
    imagePath: string,
    baseUrl: string,
    model: string,
  ): Promise<{ markers: ComplianceMarker[] }> {
    const dataUri = await this.loadImageAsDataUri(imagePath);

    const result = await this.visionChatFn({
      baseUrl,
      model,
      messages: [
        {
          role: "system",
          content:
            "You are a document compliance analyzer. Examine the document page and identify " +
            "compliance-relevant markers. For each marker found, output a JSON array with objects " +
            "having fields: type (signature|date|revision|stamp|approval|header|table|diagram), " +
            "description (brief text), present (true/false), confidence (0-1 number). " +
            "Output ONLY the JSON array.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Analyze this document page for compliance markers." },
            { type: "image_url", image_url: { url: dataUri } },
          ],
        },
      ],
      temperature: 0,
      maxTokens: 2048,
    });

    try {
      // Extract JSON from the response
      const jsonMatch = result.content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as ComplianceMarker[];
        return { markers: parsed };
      }
    } catch {
      // JSON parse failure — return empty
    }

    return { markers: [] };
  }

  /**
   * Load an image file and convert to a base64 data URI.
   */
  private async loadImageAsDataUri(imagePath: string): Promise<string> {
    if (!existsSync(imagePath)) {
      throw new Error(`Image file not found: ${imagePath}`);
    }

    const stat = statSync(imagePath);
    if (stat.size > this.maxImageBytes) {
      throw new Error(
        `Image file too large: ${(stat.size / 1024 / 1024).toFixed(1)}MB ` +
        `(max ${this.maxImageBytes / 1024 / 1024}MB)`,
      );
    }

    const buffer = await readFile(imagePath);
    const base64 = buffer.toString("base64");
    const mime = inferMime(imagePath);

    return `data:${mime};base64,${base64}`;
  }
}
