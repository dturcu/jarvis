import { describe, expect, it, afterAll } from "vitest";
import { VisionProcessor, type VisionChatFn } from "@jarvis/agent-framework";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/** Mock vision chat function that returns deterministic responses based on prompt. */
const mockVisionChatFn: VisionChatFn = async (params) => {
  const textPart = Array.isArray(params.messages[0]?.content)
    ? params.messages[0].content.find((p: any) => p.type === "text")?.text ?? ""
    : typeof params.messages[0]?.content === "string"
      ? params.messages[0].content
      : "";

  // System prompt detection for compliance markers
  const systemMsg = params.messages.find((m) => m.role === "system");
  const isComplianceAnalysis = typeof systemMsg?.content === "string" &&
    systemMsg.content.includes("compliance analyzer");
  const isOcr = typeof systemMsg?.content === "string" &&
    systemMsg.content.includes("OCR system");

  if (isComplianceAnalysis) {
    return {
      content: JSON.stringify([
        { type: "signature", description: "Author signature block", present: true, confidence: 0.9 },
        { type: "date", description: "Document date 2026-03-15", present: true, confidence: 0.95 },
        { type: "table", description: "Requirements traceability matrix", present: true, confidence: 0.85 },
      ]),
    };
  }

  if (isOcr) {
    return {
      content: "SAFETY PLAN\n\nDocument: SP-001\nRevision: 2.1\n\n1. Introduction\nThis document defines the safety plan for the ECU software project.",
    };
  }

  return {
    content: `Analysis of image: ${textPart.slice(0, 50)}. The image shows a technical diagram.`,
  };
};

describe("VisionProcessor", () => {
  let tempDir: string;

  function createTempImage(filename: string, sizeBytes = 100): string {
    if (!tempDir) {
      tempDir = mkdtempSync(join(tmpdir(), "jarvis-vision-test-"));
    }
    const filePath = join(tempDir, filename);
    // Write a small fake PNG (just bytes, not a real image — mock doesn't care)
    writeFileSync(filePath, Buffer.alloc(sizeBytes, 0x89));
    return filePath;
  }

  afterAll(() => {
    if (tempDir) {
      try { rmSync(tempDir, { recursive: true }); } catch { /* best-effort */ }
    }
  });

  it("analyzes an image and returns a description", async () => {
    const processor = new VisionProcessor({ visionChatFn: mockVisionChatFn });
    const imagePath = createTempImage("diagram.png");

    const result = await processor.analyzeImage(
      imagePath,
      "Describe the architecture diagram",
      "http://localhost:11434",
      "llava:13b",
    );

    expect(result.description).toContain("technical diagram");
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("performs OCR on a document page", async () => {
    const processor = new VisionProcessor({ visionChatFn: mockVisionChatFn });
    const imagePath = createTempImage("page.png");

    const result = await processor.ocrPage(
      imagePath,
      "http://localhost:11434",
      "llava:13b",
    );

    expect(result.text).toContain("SAFETY PLAN");
    expect(result.text).toContain("SP-001");
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("detects compliance markers in a document", async () => {
    const processor = new VisionProcessor({ visionChatFn: mockVisionChatFn });
    const imagePath = createTempImage("compliance.png");

    const result = await processor.analyzeComplianceMarkers(
      imagePath,
      "http://localhost:11434",
      "llava:13b",
    );

    expect(result.markers.length).toBe(3);
    expect(result.markers.some((m) => m.type === "signature")).toBe(true);
    expect(result.markers.some((m) => m.type === "date")).toBe(true);
    expect(result.markers.some((m) => m.type === "table")).toBe(true);
  });

  it("throws for missing image file", async () => {
    const processor = new VisionProcessor({ visionChatFn: mockVisionChatFn });

    await expect(
      processor.analyzeImage(
        "/nonexistent/path/image.png",
        "describe",
        "http://localhost:11434",
        "llava:13b",
      ),
    ).rejects.toThrow("Image file not found");
  });

  it("throws for oversized image files", async () => {
    const processor = new VisionProcessor({
      visionChatFn: mockVisionChatFn,
      maxImageSizeMB: 0.0001, // ~100 bytes
    });
    const imagePath = createTempImage("big.png", 500);

    await expect(
      processor.analyzeImage(
        imagePath,
        "describe",
        "http://localhost:11434",
        "llava:13b",
      ),
    ).rejects.toThrow("Image file too large");
  });

  it("handles unparseable compliance marker response gracefully", async () => {
    const badChatFn: VisionChatFn = async () => ({
      content: "I found some markers but cannot format them as JSON.",
    });

    const processor = new VisionProcessor({ visionChatFn: badChatFn });
    const imagePath = createTempImage("broken.png");

    const result = await processor.analyzeComplianceMarkers(
      imagePath,
      "http://localhost:11434",
      "llava:13b",
    );

    // Should return empty markers, not throw
    expect(result.markers).toHaveLength(0);
  });
});
