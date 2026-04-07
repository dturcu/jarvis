/**
 * Stress: Browser Workflows
 *
 * Tests browser automation via MockBrowserAdapter: multi-site navigation,
 * form filling, data extraction, screenshots, concurrent ops, and error recovery.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createMockBrowserAdapter, MockBrowserAdapter, BrowserWorkerError } from "@jarvis/browser-worker";
import { executeBrowserJob } from "@jarvis/browser-worker";
import type { JobEnvelope } from "@jarvis/shared";
import { range } from "./helpers.js";

function envelope(type: string, input: Record<string, unknown>): JobEnvelope {
  return {
    contract_version: "1.0.0",
    job_id: randomUUID(),
    type: type as any,
    input,
    attempt: 1,
    metadata: { agent_id: "stress-browser", run_id: randomUUID() },
  };
}

describe("Browser Workflow Stress", () => {
  let adapter: MockBrowserAdapter;

  beforeEach(() => {
    adapter = createMockBrowserAdapter();
  });

  it("multi-site navigation: 5 sites navigated and extracted", async () => {
    const sites = [
      { url: "https://example.com", title: "Example" },
      { url: "https://automotive-safety.org", title: "Safety" },
      { url: "https://iso26262.info", title: "ISO" },
      { url: "https://linkedin.com/feed", title: "LinkedIn" },
      { url: "https://dashboard.thinkingincode.com", title: "Dashboard" },
    ];

    for (const site of sites) {
      // Navigate
      const navResult = await executeBrowserJob(
        envelope("browser.navigate", { url: site.url }),
        adapter,
      );
      expect(navResult.status).toBe("completed");
      expect(navResult.structured_output?.url).toBe(site.url);

      // Extract text
      const extractResult = await executeBrowserJob(
        envelope("browser.extract", { url: site.url, format: "text" }),
        adapter,
      );
      expect(extractResult.status).toBe("completed");
      expect(extractResult.structured_output?.url).toBe(site.url);
    }

    // Should have recorded 10 actions (5 nav + 5 extract)
    expect(adapter.getActionCount()).toBe(10);
  });

  it("form filling workflow: multi-step task with click/type/submit", async () => {
    // Seed form elements
    adapter.seedPage("https://example.com/contact", "Contact Form", "<form>...</form>");
    adapter.seedSelector("input[name='name']", "");
    adapter.seedSelector("input[name='email']", "");
    adapter.seedSelector("textarea[name='message']", "");
    adapter.seedSelector("button[type='submit']", "Submit");

    // Navigate to form
    const nav = await executeBrowserJob(
      envelope("browser.navigate", { url: "https://example.com/contact" }),
      adapter,
    );
    expect(nav.status).toBe("completed");

    // Click name field
    const clickName = await executeBrowserJob(
      envelope("browser.click", { selector: "input[name='name']" }),
      adapter,
    );
    expect(clickName.status).toBe("completed");
    expect(clickName.structured_output?.clicked).toBe(true);

    // Type name
    const typeName = await executeBrowserJob(
      envelope("browser.type", { selector: "input[name='name']", text: "Daniel Turcu", clear_first: true }),
      adapter,
    );
    expect(typeName.status).toBe("completed");
    expect(typeName.structured_output?.typed).toBe(true);

    // Type email
    const typeEmail = await executeBrowserJob(
      envelope("browser.type", { selector: "input[name='email']", text: "daniel@thinkingincode.com", clear_first: true }),
      adapter,
    );
    expect(typeEmail.status).toBe("completed");

    // Type message
    const typeMsg = await executeBrowserJob(
      envelope("browser.type", { selector: "textarea[name='message']", text: "ISO 26262 consulting inquiry", clear_first: true }),
      adapter,
    );
    expect(typeMsg.status).toBe("completed");

    // Click submit
    const submit = await executeBrowserJob(
      envelope("browser.click", { selector: "button[type='submit']" }),
      adapter,
    );
    expect(submit.status).toBe("completed");

    // Verify all actions recorded
    const actions = adapter.getActions();
    expect(actions.length).toBe(6); // nav + click + 3 types + submit click
    expect(actions.map((a) => a.method)).toEqual([
      "navigate", "click", "type", "type", "type", "click",
    ]);
  });

  it("run_task with multi-step sequence", async () => {
    adapter.seedPage("https://crm.example.com/new-lead", "New Lead", "<form>...</form>");
    adapter.seedSelector("#lead-name");
    adapter.seedSelector("#lead-company");
    adapter.seedSelector("#save-btn");

    const result = await executeBrowserJob(
      envelope("browser.run_task", {
        task: "Create new CRM lead",
        url: "https://crm.example.com/new-lead",
        steps: [
          { action: "click", selector: "#lead-name" },
          { action: "type", selector: "#lead-name", value: "BMW AG" },
          { action: "click", selector: "#lead-company" },
          { action: "type", selector: "#lead-company", value: "Automotive OEM" },
          { action: "click", selector: "#save-btn" },
        ],
      }),
      adapter,
    );

    expect(result.status).toBe("completed");
    expect(result.structured_output?.steps_completed).toBe(5);
    expect(result.structured_output?.task).toBe("Create new CRM lead");
  });

  it("data extraction in text/html formats", async () => {
    adapter.seedPage("https://report.example.com", "Report", "<table><tr><td>Revenue</td><td>$1.2M</td></tr></table>");

    // Extract as text
    const textResult = await executeBrowserJob(
      envelope("browser.extract", { url: "https://report.example.com", format: "text" }),
      adapter,
    );
    expect(textResult.status).toBe("completed");
    expect(textResult.structured_output?.format).toBe("text");
    expect(textResult.structured_output?.content).toContain("Revenue");

    // Extract as HTML
    const htmlResult = await executeBrowserJob(
      envelope("browser.extract", { url: "https://report.example.com", format: "html" }),
      adapter,
    );
    expect(htmlResult.status).toBe("completed");
    expect(htmlResult.structured_output?.format).toBe("html");
    expect(htmlResult.structured_output?.content).toContain("<div>");

    // Extract specific selector
    adapter.seedSelector(".revenue-cell", "$1.2M");
    const selectorResult = await executeBrowserJob(
      envelope("browser.extract", { selector: ".revenue-cell", format: "text" }),
      adapter,
    );
    expect(selectorResult.status).toBe("completed");
    expect(selectorResult.structured_output?.content).toBe("$1.2M");
  });

  it("screenshot capture: full-page and element", async () => {
    adapter.seedPage("https://dashboard.example.com", "Dashboard", "<div>Charts</div>");
    adapter.seedSelector(".chart-widget");

    // Full-page screenshot
    const fullPage = await executeBrowserJob(
      envelope("browser.capture", { full_page: true, path: "dashboard-full.png" }),
      adapter,
    );
    expect(fullPage.status).toBe("completed");
    expect(fullPage.structured_output?.width).toBe(1280);
    expect(fullPage.structured_output?.height).toBe(720);
    expect(fullPage.structured_output?.path).toBe("dashboard-full.png");

    // Element screenshot
    const element = await executeBrowserJob(
      envelope("browser.capture", { selector: ".chart-widget", path: "chart.png" }),
      adapter,
    );
    expect(element.status).toBe("completed");
  });

  it("10 concurrent extract operations on different pages", async () => {
    // Seed 10 different pages
    for (let i = 0; i < 10; i++) {
      adapter.seedPage(`https://page-${i}.example.com`, `Page ${i}`, `Content for page ${i}`);
    }

    const results = await Promise.all(
      range(10).map(async (i) => {
        // Each needs its own adapter since seedPage overwrites state
        const localAdapter = createMockBrowserAdapter();
        localAdapter.seedPage(`https://page-${i}.example.com`, `Page ${i}`, `Content for page ${i}`);

        return executeBrowserJob(
          envelope("browser.extract", { url: `https://page-${i}.example.com`, format: "text" }),
          localAdapter,
        );
      }),
    );

    expect(results).toHaveLength(10);
    for (const r of results) {
      expect(r.status).toBe("completed");
    }
  });

  it("error recovery: unseeded elements", async () => {
    // Click non-existent selector → should fail
    const clickFail = await executeBrowserJob(
      envelope("browser.click", { selector: "#does-not-exist" }),
      adapter,
    );
    expect(clickFail.status).toBe("failed");
    expect(clickFail.error?.code).toBe("ELEMENT_NOT_FOUND");

    // Type into non-existent selector → should fail
    const typeFail = await executeBrowserJob(
      envelope("browser.type", { selector: "#phantom-input", text: "hello" }),
      adapter,
    );
    expect(typeFail.status).toBe("failed");
    expect(typeFail.error?.code).toBe("ELEMENT_NOT_FOUND");

    // Invalid job type → should fail
    const invalidType = await executeBrowserJob(
      envelope("browser.invalid_op", { data: "test" }),
      adapter,
    );
    expect(invalidType.status).toBe("failed");
    expect(invalidType.error?.code).toBe("INVALID_INPUT");
  });

  it("waitFor seeded vs unseeded selectors", async () => {
    adapter.seedSelector(".loaded-element", "Ready");

    // Wait for seeded → found
    const found = await executeBrowserJob(
      envelope("browser.wait_for", { selector: ".loaded-element", timeout_ms: 5000 }),
      adapter,
    );
    expect(found.status).toBe("completed");
    expect(found.structured_output?.found).toBe(true);
    expect(found.structured_output?.elapsed_ms).toBe(0);

    // Wait for unseeded → not found
    const notFound = await executeBrowserJob(
      envelope("browser.wait_for", { selector: ".missing-element", timeout_ms: 1000 }),
      adapter,
    );
    expect(notFound.status).toBe("completed");
    expect(notFound.structured_output?.found).toBe(false);
  });

  it("download operation returns correct metadata", async () => {
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
});
