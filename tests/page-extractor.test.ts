import { describe, expect, it } from "vitest";
import { PageExtractor } from "@jarvis/agent-framework";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";

describe("PageExtractor", () => {
  const extractor = new PageExtractor();

  it("extracts single page from a text file", async () => {
    const tmpFile = join(os.tmpdir(), `jarvis-test-${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, "Hello world. This is a test document.");
    try {
      const result = await extractor.extract(tmpFile);
      expect(result.totalPages).toBe(1);
      expect(result.pages).toHaveLength(1);
      expect(result.pages[0].text).toContain("Hello world");
      expect(result.pages[0].hasTextLayer).toBe(true);
      expect(result.fileType).toBe("txt");
      expect(result.needsVision).toBe(false);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it("extracts markdown file as single page", async () => {
    const tmpFile = join(os.tmpdir(), `jarvis-test-${Date.now()}.md`);
    fs.writeFileSync(tmpFile, "# Title\n\nSome content here.");
    try {
      const result = await extractor.extract(tmpFile);
      expect(result.fileType).toBe("markdown");
      expect(result.pages[0].text).toContain("Title");
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it("throws for missing file", async () => {
    await expect(extractor.extract("/nonexistent/file.txt")).rejects.toThrow("File not found");
  });

  it("PageExtractor type exports correctly", () => {
    expect(typeof PageExtractor).toBe("function");
    expect(typeof extractor.extract).toBe("function");
  });
});
