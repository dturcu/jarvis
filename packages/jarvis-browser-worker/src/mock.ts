import { BrowserWorkerError, type BrowserAdapter, type ExecutionOutcome } from "./adapter.js";
import type {
  BrowserNavigateInput,
  BrowserNavigateOutput,
  BrowserClickInput,
  BrowserClickOutput,
  BrowserTypeInput,
  BrowserTypeOutput,
  BrowserEvaluateInput,
  BrowserEvaluateOutput,
  BrowserWaitForInput,
  BrowserWaitForOutput,
  BrowserScreenshotInput,
  BrowserScreenshotOutput,
  BrowserExtractInput,
  BrowserExtractOutput,
  BrowserRunTaskInput,
  BrowserRunTaskOutput,
  BrowserDownloadInput,
  BrowserDownloadOutput
} from "./types.js";

export type MockAction = {
  method: string;
  input: unknown;
  timestamp: string;
};

type MockPageState = {
  url: string;
  title: string;
  selectors: Map<string, string>;  // selector → text content
};

export class MockBrowserAdapter implements BrowserAdapter {
  private page: MockPageState = {
    url: "about:blank",
    title: "",
    selectors: new Map()
  };

  private readonly actions: MockAction[] = [];
  private readonly mockNow: string;

  constructor(options: { now?: string } = {}) {
    this.mockNow = options.now ?? "2026-04-05T12:00:00.000Z";
  }

  // ── Inspection helpers ──────────────────────────────────────────────────────

  getActions(): ReadonlyArray<MockAction> {
    return [...this.actions];
  }

  getActionCount(): number {
    return this.actions.length;
  }

  getPageUrl(): string {
    return this.page.url;
  }

  getPageTitle(): string {
    return this.page.title;
  }

  /** Pre-seed a selector so click/type/waitFor won't throw ELEMENT_NOT_FOUND. */
  seedSelector(selector: string, textContent = ""): void {
    this.page.selectors.set(selector, textContent);
  }

  /** Pre-seed page state for extraction tests. */
  seedPage(url: string, title: string, body?: string): void {
    this.page.url = url;
    this.page.title = title;
    if (body !== undefined) {
      this.page.selectors.set("body", body);
    }
  }

  private record(method: string, input: unknown): void {
    this.actions.push({ method, input, timestamp: this.mockNow });
  }

  // ── navigate ───────────────────────────────────────────────────────────────

  async navigate(input: BrowserNavigateInput): Promise<ExecutionOutcome<BrowserNavigateOutput>> {
    this.record("navigate", input);

    const url = input.url;
    const host = new URL(url).hostname;
    const title = `Mock Page — ${host}`;

    this.page.url = url;
    this.page.title = title;

    return {
      summary: `Navigated to ${url} (status 200).`,
      structured_output: { url, title, status: 200 }
    };
  }

  // ── click ──────────────────────────────────────────────────────────────────

  async click(input: BrowserClickInput): Promise<ExecutionOutcome<BrowserClickOutput>> {
    this.record("click", input);

    if (!this.page.selectors.has(input.selector)) {
      throw new BrowserWorkerError(
        "ELEMENT_NOT_FOUND",
        `Mock: element "${input.selector}" not found. Seed it with seedSelector().`,
        false,
        { selector: input.selector }
      );
    }

    return {
      summary: `Clicked element matching "${input.selector}".`,
      structured_output: { selector: input.selector, clicked: true }
    };
  }

  // ── type ───────────────────────────────────────────────────────────────────

  async type(input: BrowserTypeInput): Promise<ExecutionOutcome<BrowserTypeOutput>> {
    this.record("type", input);

    if (!this.page.selectors.has(input.selector)) {
      throw new BrowserWorkerError(
        "ELEMENT_NOT_FOUND",
        `Mock: element "${input.selector}" not found. Seed it with seedSelector().`,
        false,
        { selector: input.selector }
      );
    }

    // Update content if clear_first, otherwise append
    const existing = this.page.selectors.get(input.selector) ?? "";
    const newContent = input.clear_first ? input.text : existing + input.text;
    this.page.selectors.set(input.selector, newContent);

    return {
      summary: `Typed ${input.text.length} character(s) into "${input.selector}".`,
      structured_output: {
        selector: input.selector,
        typed: true,
        text_length: input.text.length
      }
    };
  }

  // ── evaluate ───────────────────────────────────────────────────────────────

  async evaluate(input: BrowserEvaluateInput): Promise<ExecutionOutcome<BrowserEvaluateOutput>> {
    this.record("evaluate", input);

    return {
      summary: "Script evaluated successfully.",
      structured_output: { result: null }
    };
  }

  // ── waitFor ────────────────────────────────────────────────────────────────

  async waitFor(input: BrowserWaitForInput): Promise<ExecutionOutcome<BrowserWaitForOutput>> {
    this.record("waitFor", input);

    const found = this.page.selectors.has(input.selector);

    return {
      summary: found
        ? `Element "${input.selector}" found after 0ms.`
        : `Element "${input.selector}" not found within ${input.timeout_ms ?? 30000}ms.`,
      structured_output: {
        selector: input.selector,
        found,
        elapsed_ms: found ? 0 : (input.timeout_ms ?? 30_000)
      }
    };
  }

  // ── screenshot ─────────────────────────────────────────────────────────────

  async screenshot(input: BrowserScreenshotInput): Promise<ExecutionOutcome<BrowserScreenshotOutput>> {
    this.record("screenshot", input);

    const path = input.path ?? "screenshot.png";

    return {
      summary: `Captured screenshot to ${path}.`,
      structured_output: {
        path,
        width: 1280,
        height: 720
      }
    };
  }

  // ── extract ────────────────────────────────────────────────────────────────

  async extract(input: BrowserExtractInput): Promise<ExecutionOutcome<BrowserExtractOutput>> {
    this.record("extract", input);

    if (input.url) {
      const host = new URL(input.url).hostname;
      this.page.url = input.url;
      this.page.title = `Mock Page — ${host}`;
    }

    const format = input.format ?? "text";
    let content: string;

    if (input.selector) {
      content = this.page.selectors.get(input.selector) ?? `Mock content for "${input.selector}"`;
    } else {
      content = this.page.selectors.get("body") ?? "Mock page body content.";
    }

    if (format === "html") {
      content = `<div>${content}</div>`;
    }

    return {
      summary: `Extracted ${format} content from ${this.page.url} (${content.length} chars).`,
      structured_output: {
        content,
        format,
        url: this.page.url,
        title: this.page.title
      }
    };
  }

  // ── runTask ────────────────────────────────────────────────────────────────

  async runTask(input: BrowserRunTaskInput): Promise<ExecutionOutcome<BrowserRunTaskOutput>> {
    this.record("runTask", input);

    if (input.url) {
      const host = new URL(input.url).hostname;
      this.page.url = input.url;
      this.page.title = `Mock Page — ${host}`;
    }

    const stepsCompleted = input.steps?.length ?? 0;

    return {
      summary: `Completed task "${input.task}" (${stepsCompleted} step(s)).`,
      structured_output: {
        task: input.task,
        steps_completed: stepsCompleted,
        result: null,
        url: this.page.url,
        title: this.page.title
      }
    };
  }

  // ── download ───────────────────────────────────────────────────────────────

  async download(input: BrowserDownloadInput): Promise<ExecutionOutcome<BrowserDownloadOutput>> {
    this.record("download", input);

    const destPath = input.dest_path ?? "download";

    return {
      summary: `Downloaded from ${input.url} to ${destPath}.`,
      structured_output: {
        url: input.url,
        dest_path: destPath,
        size_bytes: 1024,
        content_type: "application/octet-stream"
      }
    };
  }
}

export function createMockBrowserAdapter(
  options: { now?: string } = {}
): MockBrowserAdapter {
  return new MockBrowserAdapter(options);
}
