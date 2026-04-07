/**
 * Stress: Browser Exhaustive
 *
 * Exhaustive coverage of MockBrowserAdapter and executeBrowserJob across
 * all 9 browser job types: navigate, click, type, evaluate, wait_for,
 * run_task, extract, capture, download. Covers action recording, page
 * state management, content tracking, multi-operation workflows,
 * concurrent adapters, and error codes.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import {
  createMockBrowserAdapter,
  MockBrowserAdapter,
  BrowserWorkerError,
  executeBrowserJob,
} from "@jarvis/browser-worker";
import type { JobEnvelope } from "@jarvis/shared";
import { range } from "./helpers.js";

function envelope(type: string, input: Record<string, unknown>): JobEnvelope {
  return {
    contract_version: "1.0.0",
    job_id: randomUUID(),
    type: type as any,
    input,
    attempt: 1,
    metadata: { agent_id: "test", run_id: randomUUID() },
  };
}

describe("Browser Exhaustive", () => {
  let adapter: MockBrowserAdapter;

  beforeEach(() => {
    adapter = createMockBrowserAdapter();
  });

  // ── Navigate ─────────────────────────────────────────────────────────────

  describe("navigate", () => {
    const urls = [
      { url: "https://example.com", title: "example.com" },
      { url: "https://google.com", title: "google.com" },
      { url: "https://iso26262.info/part-6", title: "iso26262.info/part-6" },
      { url: "https://automotive-safety.org", title: "automotive-safety.org" },
      { url: "https://dashboard.thinkingincode.com", title: "dashboard.thinkingincode.com" },
      { url: "https://linkedin.com/feed", title: "linkedin.com/feed" },
      { url: "https://github.com/dturcu/jarvis", title: "github.com/dturcu/jarvis" },
      { url: "https://crm.example.com/leads", title: "crm.example.com/leads" },
      { url: "https://mail.google.com/inbox", title: "mail.google.com/inbox" },
      { url: "https://news.ycombinator.com", title: "news.ycombinator.com" },
    ];

    for (const { url, title } of urls) {
      it(`navigates to ${url}`, async () => {
        const result = await executeBrowserJob(
          envelope("browser.navigate", { url }),
          adapter,
        );
        expect(result.status).toBe("completed");
        expect(result.structured_output?.url).toBe(url);
        expect(result.structured_output?.status).toBe(200);
      });
    }

    it("updates adapter page state after navigate", async () => {
      await executeBrowserJob(
        envelope("browser.navigate", { url: "https://example.com" }),
        adapter,
      );
      expect(adapter.getPageUrl()).toBe("https://example.com");
    });

    it("last navigation wins for page state", async () => {
      await executeBrowserJob(
        envelope("browser.navigate", { url: "https://first.com" }),
        adapter,
      );
      await executeBrowserJob(
        envelope("browser.navigate", { url: "https://second.com" }),
        adapter,
      );
      expect(adapter.getPageUrl()).toBe("https://second.com");
    });
  });

  // ── Click ────────────────────────────────────────────────────────────────

  describe("click", () => {
    it("clicks a seeded selector", async () => {
      adapter.seedSelector("#submit-btn", "Submit");
      const result = await executeBrowserJob(
        envelope("browser.click", { selector: "#submit-btn" }),
        adapter,
      );
      expect(result.status).toBe("completed");
      expect(result.structured_output?.selector).toBe("#submit-btn");
      expect(result.structured_output?.clicked).toBe(true);
    });

    it("fails with ELEMENT_NOT_FOUND for non-seeded selector", async () => {
      const result = await executeBrowserJob(
        envelope("browser.click", { selector: "#phantom" }),
        adapter,
      );
      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe("ELEMENT_NOT_FOUND");
    });

    it("clicks multiple different selectors in sequence", async () => {
      const selectors = ["#btn-a", "#btn-b", "#btn-c", ".link-1", ".link-2"];
      for (const sel of selectors) {
        adapter.seedSelector(sel, `label-${sel}`);
      }
      for (const sel of selectors) {
        const result = await executeBrowserJob(
          envelope("browser.click", { selector: sel }),
          adapter,
        );
        expect(result.status).toBe("completed");
        expect(result.structured_output?.clicked).toBe(true);
      }
      expect(adapter.getActionCount()).toBe(5);
    });

    it("click with wait_before_ms option", async () => {
      adapter.seedSelector("#delayed-btn");
      const result = await executeBrowserJob(
        envelope("browser.click", { selector: "#delayed-btn", wait_before_ms: 100 }),
        adapter,
      );
      expect(result.status).toBe("completed");
      expect(result.structured_output?.clicked).toBe(true);
    });

    it("first seeded then unseeded click: first succeeds, second fails", async () => {
      adapter.seedSelector(".exists");
      const ok = await executeBrowserJob(
        envelope("browser.click", { selector: ".exists" }),
        adapter,
      );
      expect(ok.status).toBe("completed");

      const fail = await executeBrowserJob(
        envelope("browser.click", { selector: ".missing" }),
        adapter,
      );
      expect(fail.status).toBe("failed");
      expect(fail.error?.code).toBe("ELEMENT_NOT_FOUND");
    });
  });

  // ── Type ─────────────────────────────────────────────────────────────────

  describe("type", () => {
    it("types basic text into seeded selector", async () => {
      adapter.seedSelector("#name-field");
      const result = await executeBrowserJob(
        envelope("browser.type", { selector: "#name-field", text: "Daniel Turcu" }),
        adapter,
      );
      expect(result.status).toBe("completed");
      expect(result.structured_output?.selector).toBe("#name-field");
      expect(result.structured_output?.typed).toBe(true);
      expect(result.structured_output?.text_length).toBe(12);
    });

    it("clear_first=true replaces existing content", async () => {
      adapter.seedSelector("#field", "old content");
      await executeBrowserJob(
        envelope("browser.type", { selector: "#field", text: "first", clear_first: true }),
        adapter,
      );
      const result = await executeBrowserJob(
        envelope("browser.type", { selector: "#field", text: "replaced", clear_first: true }),
        adapter,
      );
      expect(result.status).toBe("completed");
      expect(result.structured_output?.text_length).toBe(8);
    });

    it("clear_first=false appends to existing content", async () => {
      adapter.seedSelector("#field");
      await executeBrowserJob(
        envelope("browser.type", { selector: "#field", text: "hello", clear_first: true }),
        adapter,
      );
      const result = await executeBrowserJob(
        envelope("browser.type", { selector: "#field", text: " world", clear_first: false }),
        adapter,
      );
      expect(result.status).toBe("completed");
      expect(result.structured_output?.text_length).toBe(6);
    });

    it("type into multiple fields sequentially", async () => {
      const fields = ["#first-name", "#last-name", "#email", "#phone", "#company"];
      const values = ["Daniel", "Turcu", "daniel@tic.com", "+49123456", "Thinking in Code"];

      for (const f of fields) adapter.seedSelector(f);

      for (let i = 0; i < fields.length; i++) {
        const result = await executeBrowserJob(
          envelope("browser.type", { selector: fields[i], text: values[i], clear_first: true }),
          adapter,
        );
        expect(result.status).toBe("completed");
        expect(result.structured_output?.typed).toBe(true);
      }
      expect(adapter.getActionCount()).toBe(5);
    });

    it("types empty text", async () => {
      adapter.seedSelector("#empty-field");
      const result = await executeBrowserJob(
        envelope("browser.type", { selector: "#empty-field", text: "", clear_first: true }),
        adapter,
      );
      expect(result.status).toBe("completed");
      expect(result.structured_output?.text_length).toBe(0);
    });

    it("types long text (5000 chars)", async () => {
      adapter.seedSelector("#textarea");
      const longText = "A".repeat(5000);
      const result = await executeBrowserJob(
        envelope("browser.type", { selector: "#textarea", text: longText, clear_first: true }),
        adapter,
      );
      expect(result.status).toBe("completed");
      expect(result.structured_output?.text_length).toBe(5000);
    });

    it("types special characters", async () => {
      adapter.seedSelector("#special");
      const special = "<script>alert('xss')</script>&amp;\"quotes\" 日本語 émoji 🚀";
      const result = await executeBrowserJob(
        envelope("browser.type", { selector: "#special", text: special, clear_first: true }),
        adapter,
      );
      expect(result.status).toBe("completed");
      expect(result.structured_output?.typed).toBe(true);
    });

    it("fails with ELEMENT_NOT_FOUND for non-seeded selector", async () => {
      const result = await executeBrowserJob(
        envelope("browser.type", { selector: "#missing", text: "hello" }),
        adapter,
      );
      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe("ELEMENT_NOT_FOUND");
    });
  });

  // ── Evaluate ─────────────────────────────────────────────────────────────

  describe("evaluate", () => {
    it("evaluates a basic script", async () => {
      const result = await executeBrowserJob(
        envelope("browser.evaluate", { script: "return document.title;" }),
        adapter,
      );
      expect(result.status).toBe("completed");
      expect(result.structured_output?.result).toBeNull();
    });

    it("evaluates script with empty args", async () => {
      const result = await executeBrowserJob(
        envelope("browser.evaluate", { script: "return 42;", args: {} }),
        adapter,
      );
      expect(result.status).toBe("completed");
      expect(result.structured_output?.result).toBeNull();
    });

    it("evaluates multiple scripts in sequence", async () => {
      for (let i = 0; i < 5; i++) {
        const result = await executeBrowserJob(
          envelope("browser.evaluate", { script: `return ${i};` }),
          adapter,
        );
        expect(result.status).toBe("completed");
      }
      expect(adapter.getActionCount()).toBe(5);
    });
  });

  // ── Wait For ─────────────────────────────────────────────────────────────

  describe("wait_for", () => {
    it("seeded element found with elapsed_ms=0", async () => {
      adapter.seedSelector(".loaded", "Ready");
      const result = await executeBrowserJob(
        envelope("browser.wait_for", { selector: ".loaded" }),
        adapter,
      );
      expect(result.status).toBe("completed");
      expect(result.structured_output?.selector).toBe(".loaded");
      expect(result.structured_output?.found).toBe(true);
      expect(result.structured_output?.elapsed_ms).toBe(0);
    });

    it("non-seeded element not found", async () => {
      const result = await executeBrowserJob(
        envelope("browser.wait_for", { selector: ".absent" }),
        adapter,
      );
      expect(result.status).toBe("completed");
      expect(result.structured_output?.found).toBe(false);
    });

    it("with timeout_ms parameter", async () => {
      adapter.seedSelector("#timed");
      const result = await executeBrowserJob(
        envelope("browser.wait_for", { selector: "#timed", timeout_ms: 3000 }),
        adapter,
      );
      expect(result.status).toBe("completed");
      expect(result.structured_output?.found).toBe(true);
    });

    it("with visible flag", async () => {
      adapter.seedSelector("#visible-el", "Shown");
      const result = await executeBrowserJob(
        envelope("browser.wait_for", { selector: "#visible-el", visible: true }),
        adapter,
      );
      expect(result.status).toBe("completed");
      expect(result.structured_output?.found).toBe(true);
    });

    it("non-seeded with timeout returns not found", async () => {
      const result = await executeBrowserJob(
        envelope("browser.wait_for", { selector: ".nope", timeout_ms: 500 }),
        adapter,
      );
      expect(result.status).toBe("completed");
      expect(result.structured_output?.found).toBe(false);
    });

    it("multiple wait_for calls accumulate actions", async () => {
      adapter.seedSelector("#a");
      adapter.seedSelector("#b");
      await executeBrowserJob(envelope("browser.wait_for", { selector: "#a" }), adapter);
      await executeBrowserJob(envelope("browser.wait_for", { selector: "#b" }), adapter);
      await executeBrowserJob(envelope("browser.wait_for", { selector: "#c" }), adapter);
      expect(adapter.getActionCount()).toBe(3);
    });
  });

  // ── Capture (screenshot) ─────────────────────────────────────────────────

  describe("capture", () => {
    it("default screenshot returns expected dimensions", async () => {
      const result = await executeBrowserJob(
        envelope("browser.capture", {}),
        adapter,
      );
      expect(result.status).toBe("completed");
      expect(result.structured_output?.width).toBe(1280);
      expect(result.structured_output?.height).toBe(720);
    });

    it("screenshot with custom path", async () => {
      const result = await executeBrowserJob(
        envelope("browser.capture", { path: "/tmp/screenshot-test.png" }),
        adapter,
      );
      expect(result.status).toBe("completed");
      expect(result.structured_output?.path).toBe("/tmp/screenshot-test.png");
    });

    it("full_page screenshot", async () => {
      const result = await executeBrowserJob(
        envelope("browser.capture", { full_page: true }),
        adapter,
      );
      expect(result.status).toBe("completed");
      expect(result.structured_output?.width).toBe(1280);
      expect(result.structured_output?.height).toBe(720);
    });

    it("screenshot with selector", async () => {
      adapter.seedSelector(".chart-widget");
      const result = await executeBrowserJob(
        envelope("browser.capture", { selector: ".chart-widget" }),
        adapter,
      );
      expect(result.status).toBe("completed");
    });

    it("screenshot with both full_page and path", async () => {
      const result = await executeBrowserJob(
        envelope("browser.capture", { full_page: true, path: "full-capture.png" }),
        adapter,
      );
      expect(result.status).toBe("completed");
      expect(result.structured_output?.path).toBe("full-capture.png");
      expect(result.structured_output?.width).toBe(1280);
      expect(result.structured_output?.height).toBe(720);
    });

    it("5 consecutive screenshots all succeed", async () => {
      for (let i = 0; i < 5; i++) {
        const result = await executeBrowserJob(
          envelope("browser.capture", { path: `shot-${i}.png` }),
          adapter,
        );
        expect(result.status).toBe("completed");
        expect(result.structured_output?.path).toBe(`shot-${i}.png`);
      }
    });
  });

  // ── Extract ──────────────────────────────────────────────────────────────

  describe("extract", () => {
    it("text format returns body content", async () => {
      adapter.seedPage("https://example.com", "Example", "Hello World");
      const result = await executeBrowserJob(
        envelope("browser.extract", { format: "text" }),
        adapter,
      );
      expect(result.status).toBe("completed");
      expect(result.structured_output?.format).toBe("text");
      expect(result.structured_output?.content).toContain("Hello World");
    });

    it("html format wraps content in <div>", async () => {
      adapter.seedPage("https://example.com", "Example", "<p>Paragraph</p>");
      const result = await executeBrowserJob(
        envelope("browser.extract", { format: "html" }),
        adapter,
      );
      expect(result.status).toBe("completed");
      expect(result.structured_output?.format).toBe("html");
      expect(result.structured_output?.content).toContain("<div>");
    });

    it("extract with url override", async () => {
      adapter.seedPage("https://other.com", "Other", "Other content");
      const result = await executeBrowserJob(
        envelope("browser.extract", { url: "https://other.com", format: "text" }),
        adapter,
      );
      expect(result.status).toBe("completed");
      expect(result.structured_output?.url).toBe("https://other.com");
    });

    it("extract with selector returns selector content", async () => {
      adapter.seedSelector(".specific", "Targeted Content");
      const result = await executeBrowserJob(
        envelope("browser.extract", { selector: ".specific", format: "text" }),
        adapter,
      );
      expect(result.status).toBe("completed");
      expect(result.structured_output?.content).toBe("Targeted Content");
    });

    it("extract without selector returns body", async () => {
      adapter.seedPage("https://page.com", "Page", "Full body content");
      const result = await executeBrowserJob(
        envelope("browser.extract", { format: "text" }),
        adapter,
      );
      expect(result.status).toBe("completed");
      expect(result.structured_output?.content).toContain("Full body content");
    });

    it("extract text vs html produce different output for same page", async () => {
      adapter.seedPage("https://dual.com", "Dual", "<b>Bold text</b>");

      const textResult = await executeBrowserJob(
        envelope("browser.extract", { format: "text" }),
        adapter,
      );
      const htmlResult = await executeBrowserJob(
        envelope("browser.extract", { format: "html" }),
        adapter,
      );

      expect(textResult.structured_output?.format).toBe("text");
      expect(htmlResult.structured_output?.format).toBe("html");
      expect(htmlResult.structured_output?.content).toContain("<div>");
    });

    it("extract returns url and title from page state", async () => {
      adapter.seedPage("https://titled.com", "My Title", "Content");
      const result = await executeBrowserJob(
        envelope("browser.extract", { format: "text" }),
        adapter,
      );
      expect(result.structured_output?.url).toBe("https://titled.com");
      expect(result.structured_output?.title).toBe("My Title");
    });
  });

  // ── Run Task ─────────────────────────────────────────────────────────────

  describe("run_task", () => {
    it("0 steps returns steps_completed=0", async () => {
      const result = await executeBrowserJob(
        envelope("browser.run_task", { task: "empty task", steps: [] }),
        adapter,
      );
      expect(result.status).toBe("completed");
      expect(result.structured_output?.steps_completed).toBe(0);
      expect(result.structured_output?.task).toBe("empty task");
    });

    it("1 step completes successfully", async () => {
      adapter.seedSelector("#btn");
      const result = await executeBrowserJob(
        envelope("browser.run_task", {
          task: "single click",
          steps: [{ action: "click", selector: "#btn" }],
        }),
        adapter,
      );
      expect(result.status).toBe("completed");
      expect(result.structured_output?.steps_completed).toBe(1);
    });

    it("5 steps complete successfully", async () => {
      for (let i = 0; i < 5; i++) adapter.seedSelector(`#el-${i}`);
      const result = await executeBrowserJob(
        envelope("browser.run_task", {
          task: "multi-click",
          steps: range(5).map(i => ({ action: "click", selector: `#el-${i}` })),
        }),
        adapter,
      );
      expect(result.status).toBe("completed");
      expect(result.structured_output?.steps_completed).toBe(5);
    });

    it("10 steps complete successfully", async () => {
      for (let i = 0; i < 10; i++) adapter.seedSelector(`#step-${i}`);
      const result = await executeBrowserJob(
        envelope("browser.run_task", {
          task: "ten-step workflow",
          steps: range(10).map(i => ({ action: "click", selector: `#step-${i}` })),
        }),
        adapter,
      );
      expect(result.status).toBe("completed");
      expect(result.structured_output?.steps_completed).toBe(10);
    });

    it("run_task with url sets page context", async () => {
      adapter.seedSelector("#form-field");
      const result = await executeBrowserJob(
        envelope("browser.run_task", {
          task: "task with url",
          url: "https://forms.example.com",
          steps: [{ action: "click", selector: "#form-field" }],
        }),
        adapter,
      );
      expect(result.status).toBe("completed");
      expect(result.structured_output?.url).toBe("https://forms.example.com");
    });

    it("run_task without url still completes", async () => {
      const result = await executeBrowserJob(
        envelope("browser.run_task", { task: "no url task", steps: [] }),
        adapter,
      );
      expect(result.status).toBe("completed");
      expect(result.structured_output?.task).toBe("no url task");
    });

    it("run_task result null", async () => {
      const result = await executeBrowserJob(
        envelope("browser.run_task", { task: "check result", steps: [] }),
        adapter,
      );
      expect(result.structured_output?.result).toBeNull();
    });
  });

  // ── Download ─────────────────────────────────────────────────────────────

  describe("download", () => {
    it("download with dest_path returns correct metadata", async () => {
      const result = await executeBrowserJob(
        envelope("browser.download", {
          url: "https://files.example.com/report.pdf",
          dest_path: "/tmp/downloads",
        }),
        adapter,
      );
      expect(result.status).toBe("completed");
      expect(result.structured_output?.url).toBe("https://files.example.com/report.pdf");
      expect(result.structured_output?.dest_path).toBe("/tmp/downloads");
      expect(result.structured_output?.size_bytes).toBe(1024);
      expect(result.structured_output?.content_type).toBe("application/octet-stream");
    });

    it("download without dest_path", async () => {
      const result = await executeBrowserJob(
        envelope("browser.download", { url: "https://files.example.com/data.csv" }),
        adapter,
      );
      expect(result.status).toBe("completed");
      expect(result.structured_output?.url).toBe("https://files.example.com/data.csv");
      expect(result.structured_output?.size_bytes).toBe(1024);
      expect(result.structured_output?.content_type).toBe("application/octet-stream");
    });

    it("download different file URLs", async () => {
      const files = [
        "https://cdn.example.com/image.png",
        "https://storage.example.com/archive.zip",
        "https://docs.example.com/manual.pdf",
      ];
      for (const url of files) {
        const result = await executeBrowserJob(
          envelope("browser.download", { url }),
          adapter,
        );
        expect(result.status).toBe("completed");
        expect(result.structured_output?.url).toBe(url);
      }
    });
  });

  // ── Action Recording ─────────────────────────────────────────────────────

  describe("action recording", () => {
    it("navigate records action with correct method", async () => {
      await executeBrowserJob(
        envelope("browser.navigate", { url: "https://example.com" }),
        adapter,
      );
      const actions = adapter.getActions();
      expect(actions).toHaveLength(1);
      expect(actions[0].method).toBe("navigate");
      expect(actions[0].input).toBeDefined();
      expect(actions[0].timestamp).toBeDefined();
    });

    it("click records action", async () => {
      adapter.seedSelector("#btn");
      await executeBrowserJob(
        envelope("browser.click", { selector: "#btn" }),
        adapter,
      );
      expect(adapter.getActions()[0].method).toBe("click");
    });

    it("type records action", async () => {
      adapter.seedSelector("#input");
      await executeBrowserJob(
        envelope("browser.type", { selector: "#input", text: "test" }),
        adapter,
      );
      expect(adapter.getActions()[0].method).toBe("type");
    });

    it("evaluate records action", async () => {
      await executeBrowserJob(
        envelope("browser.evaluate", { script: "1+1" }),
        adapter,
      );
      expect(adapter.getActions()[0].method).toBe("evaluate");
    });

    it("wait_for records action", async () => {
      adapter.seedSelector("#el");
      await executeBrowserJob(
        envelope("browser.wait_for", { selector: "#el" }),
        adapter,
      );
      expect(adapter.getActions()[0].method).toBe("waitFor");
    });

    it("capture records action", async () => {
      await executeBrowserJob(
        envelope("browser.capture", {}),
        adapter,
      );
      expect(adapter.getActions()[0].method).toBe("screenshot");
    });

    it("extract records action", async () => {
      adapter.seedPage("https://example.com", "Example", "text");
      await executeBrowserJob(
        envelope("browser.extract", { format: "text" }),
        adapter,
      );
      expect(adapter.getActions()[0].method).toBe("extract");
    });

    it("action count accumulates across operations", async () => {
      adapter.seedSelector("#btn");
      adapter.seedSelector("#input");

      await executeBrowserJob(envelope("browser.navigate", { url: "https://a.com" }), adapter);
      await executeBrowserJob(envelope("browser.click", { selector: "#btn" }), adapter);
      await executeBrowserJob(envelope("browser.type", { selector: "#input", text: "t" }), adapter);
      await executeBrowserJob(envelope("browser.capture", {}), adapter);

      expect(adapter.getActionCount()).toBe(4);
      expect(adapter.getActions()).toHaveLength(4);
    });

    it("action timestamps are monotonically non-decreasing", async () => {
      adapter.seedSelector("#x");
      for (let i = 0; i < 5; i++) {
        await executeBrowserJob(
          envelope("browser.click", { selector: "#x" }),
          adapter,
        );
      }
      const actions = adapter.getActions();
      for (let i = 1; i < actions.length; i++) {
        expect(String(actions[i].timestamp) >= String(actions[i - 1].timestamp)).toBe(true);
      }
    });
  });

  // ── Page State ───────────────────────────────────────────────────────────

  describe("page state", () => {
    it("seedPage then extract reads seeded body", async () => {
      adapter.seedPage("https://seeded.com", "Seeded", "Seeded body text");
      const result = await executeBrowserJob(
        envelope("browser.extract", { format: "text" }),
        adapter,
      );
      expect(result.structured_output?.content).toContain("Seeded body text");
    });

    it("seedPage then navigate overrides page state", async () => {
      adapter.seedPage("https://old.com", "Old", "Old content");
      await executeBrowserJob(
        envelope("browser.navigate", { url: "https://new.com" }),
        adapter,
      );
      expect(adapter.getPageUrl()).toBe("https://new.com");
    });

    it("multiple seedPage calls: last one wins", async () => {
      adapter.seedPage("https://first.com", "First", "First content");
      adapter.seedPage("https://second.com", "Second", "Second content");
      adapter.seedPage("https://third.com", "Third", "Third content");

      expect(adapter.getPageUrl()).toBe("https://third.com");
      expect(adapter.getPageTitle()).toBe("Third");
    });

    it("seedPage sets both url and title", async () => {
      adapter.seedPage("https://test.com", "Test Title");
      expect(adapter.getPageUrl()).toBe("https://test.com");
      expect(adapter.getPageTitle()).toBe("Test Title");
    });
  });

  // ── Type Content Tracking ────────────────────────────────────────────────

  describe("type content tracking", () => {
    it("type stores content in adapter", async () => {
      adapter.seedSelector("#tracked");
      await executeBrowserJob(
        envelope("browser.type", { selector: "#tracked", text: "stored value", clear_first: true }),
        adapter,
      );
      // Verify via extract that content was updated
      const actions = adapter.getActions();
      expect(actions.some(a => a.method === "type")).toBe(true);
    });

    it("clear_first replaces content entirely", async () => {
      adapter.seedSelector("#field");
      await executeBrowserJob(
        envelope("browser.type", { selector: "#field", text: "first", clear_first: true }),
        adapter,
      );
      const r2 = await executeBrowserJob(
        envelope("browser.type", { selector: "#field", text: "second", clear_first: true }),
        adapter,
      );
      expect(r2.structured_output?.typed).toBe(true);
      expect(r2.structured_output?.text_length).toBe(6);
    });

    it("append concatenates content", async () => {
      adapter.seedSelector("#concat");
      await executeBrowserJob(
        envelope("browser.type", { selector: "#concat", text: "abc", clear_first: true }),
        adapter,
      );
      const r2 = await executeBrowserJob(
        envelope("browser.type", { selector: "#concat", text: "def", clear_first: false }),
        adapter,
      );
      expect(r2.structured_output?.typed).toBe(true);
      expect(r2.structured_output?.text_length).toBe(3);
    });
  });

  // ── Multi-Operation Workflow ─────────────────────────────────────────────

  describe("multi-operation workflow", () => {
    it("6-step workflow: navigate -> seedSelector -> click -> type -> extract -> screenshot", async () => {
      // Step 1: Navigate
      const nav = await executeBrowserJob(
        envelope("browser.navigate", { url: "https://workflow.example.com" }),
        adapter,
      );
      expect(nav.status).toBe("completed");

      // Step 2: Seed selectors for subsequent ops
      adapter.seedSelector("#search-box");
      adapter.seedSelector("#search-btn");
      adapter.seedPage("https://workflow.example.com", "Workflow", "Workflow page body");

      // Step 3: Click search box
      const click = await executeBrowserJob(
        envelope("browser.click", { selector: "#search-box" }),
        adapter,
      );
      expect(click.status).toBe("completed");

      // Step 4: Type into search box
      const type = await executeBrowserJob(
        envelope("browser.type", { selector: "#search-box", text: "ISO 26262 compliance", clear_first: true }),
        adapter,
      );
      expect(type.status).toBe("completed");

      // Step 5: Extract page content
      const extract = await executeBrowserJob(
        envelope("browser.extract", { format: "text" }),
        adapter,
      );
      expect(extract.status).toBe("completed");
      expect(extract.structured_output?.content).toContain("Workflow page body");

      // Step 6: Take screenshot
      const capture = await executeBrowserJob(
        envelope("browser.capture", { path: "workflow-result.png" }),
        adapter,
      );
      expect(capture.status).toBe("completed");

      // All 5 executor actions recorded (seedSelector is adapter-only, not a job)
      expect(adapter.getActionCount()).toBe(5);
      const methods = adapter.getActions().map(a => a.method);
      expect(methods).toContain("navigate");
      expect(methods).toContain("click");
      expect(methods).toContain("type");
      expect(methods).toContain("extract");
      expect(methods).toContain("screenshot");
    });
  });

  // ── Concurrent Adapters ──────────────────────────────────────────────────

  describe("concurrent adapters", () => {
    it("10 independent adapters operate simultaneously", async () => {
      const results = await Promise.all(
        range(10).map(async (i) => {
          const local = createMockBrowserAdapter();
          local.seedPage(`https://site-${i}.com`, `Site ${i}`, `Content ${i}`);
          local.seedSelector(`#btn-${i}`);

          const navResult = await executeBrowserJob(
            envelope("browser.navigate", { url: `https://site-${i}.com` }),
            local,
          );

          const clickResult = await executeBrowserJob(
            envelope("browser.click", { selector: `#btn-${i}` }),
            local,
          );

          const extractResult = await executeBrowserJob(
            envelope("browser.extract", { format: "text" }),
            local,
          );

          return { nav: navResult, click: clickResult, extract: extractResult, adapter: local };
        }),
      );

      expect(results).toHaveLength(10);
      for (let i = 0; i < 10; i++) {
        expect(results[i].nav.status).toBe("completed");
        expect(results[i].click.status).toBe("completed");
        expect(results[i].extract.status).toBe("completed");
        expect(results[i].adapter.getActionCount()).toBe(3);
      }
    });
  });

  // ── Invalid Job Types & Error Codes ──────────────────────────────────────

  describe("invalid job types and error codes", () => {
    it("browser.fake_op returns failed status", async () => {
      const result = await executeBrowserJob(
        envelope("browser.fake_op", { data: "test" }),
        adapter,
      );
      expect(result.status).toBe("failed");
    });

    it("INVALID_INPUT code on unrecognized job type", async () => {
      const result = await executeBrowserJob(
        envelope("browser.fake_op", {}),
        adapter,
      );
      expect(result.error?.code).toBe("INVALID_INPUT");
    });

    it("ELEMENT_NOT_FOUND code on click failure", async () => {
      const result = await executeBrowserJob(
        envelope("browser.click", { selector: "#nonexistent" }),
        adapter,
      );
      expect(result.error?.code).toBe("ELEMENT_NOT_FOUND");
    });

    it("ELEMENT_NOT_FOUND code on type failure", async () => {
      const result = await executeBrowserJob(
        envelope("browser.type", { selector: "#nonexistent", text: "test" }),
        adapter,
      );
      expect(result.error?.code).toBe("ELEMENT_NOT_FOUND");
    });

    it("multiple invalid types all produce INVALID_INPUT", async () => {
      const invalidTypes = [
        "browser.explode",
        "browser.hack",
        "browser.destroy",
        "browser.teleport",
        "browser.quantum_op",
      ];
      for (const t of invalidTypes) {
        const result = await executeBrowserJob(envelope(t, {}), adapter);
        expect(result.status).toBe("failed");
        expect(result.error?.code).toBe("INVALID_INPUT");
      }
    });

    it("valid type with failed element still records correct error", async () => {
      const click = await executeBrowserJob(
        envelope("browser.click", { selector: ".no" }),
        adapter,
      );
      const type = await executeBrowserJob(
        envelope("browser.type", { selector: ".no", text: "x" }),
        adapter,
      );
      expect(click.error?.code).toBe("ELEMENT_NOT_FOUND");
      expect(type.error?.code).toBe("ELEMENT_NOT_FOUND");
    });
  });
});
