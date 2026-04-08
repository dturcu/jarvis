import puppeteer from "puppeteer-core";
import type { Browser, Page } from "puppeteer-core";
import os from "node:os";
import path from "node:path";
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

// ── Script sanitization ───────────────────────────────────────────────────────

const BLOCKED_PATTERNS = [
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\b/,
  /\bnavigator\s*\.\s*sendBeacon\b/,
  /\bnew\s+Worker\s*\(/,
  /\bimport\s*\(/,
  /\bdocument\s*\.\s*cookie\b/,
  /\blocalStorage\b/,
  /\bsessionStorage\b/,
  /\bindexedDB\b/,
  /\bcaches\s*\.\s*(open|match|keys)\b/,
] as const;

/** @internal Exported for testing only. */
export function sanitizeScript(script: string): void {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(script)) {
      throw new BrowserWorkerError(
        "SCRIPT_BLOCKED",
        `Script contains blocked pattern: ${pattern.source}`,
        false,
        { pattern: pattern.source },
      );
    }
  }
}

const DEFAULT_EVAL_TIMEOUT_MS = 30_000;

export type ChromeAdapterConfig = {
  debugging_url?: string;
  /** Allowed base directories for downloads. Defaults to [os.tmpdir()]. */
  allowed_download_dirs?: string[];
};

export class ChromeAdapter implements BrowserAdapter {
  private browser: Browser | null = null;
  private readonly debuggingUrl: string;
  private readonly allowedDownloadDirs: string[];

  constructor(config: ChromeAdapterConfig = {}) {
    this.debuggingUrl = config.debugging_url ?? "http://127.0.0.1:9222";
    this.allowedDownloadDirs = (config.allowed_download_dirs ?? [os.tmpdir()])
      .map(d => path.resolve(d));
  }

  /**
   * Validate that a download destination path resolves within one of the
   * allowed download directories. Prevents path traversal attacks.
   */
  private validateDownloadPath(destPath: string): string {
    const resolved = path.resolve(destPath);
    const allowed = this.allowedDownloadDirs.some(
      dir => resolved.startsWith(dir + path.sep) || resolved === dir,
    );
    if (!allowed) {
      throw new BrowserWorkerError(
        "DOWNLOAD_FAILED",
        `Download path "${destPath}" is outside allowed directories: ${this.allowedDownloadDirs.join(", ")}`,
        false,
        { dest_path: destPath, allowed_dirs: this.allowedDownloadDirs },
      );
    }
    return resolved;
  }

  /**
   * Validate that an output file path (screenshot, task artifact) resolves
   * within the current working directory or temp directory.
   * Prevents path traversal via user-controlled screenshot/task paths.
   */
  private validateOutputPath(filePath: string): string {
    const resolved = path.resolve(filePath);
    const cwd = path.resolve(".");
    const tmp = path.resolve(os.tmpdir());
    if (
      (resolved.startsWith(cwd + path.sep) || resolved === cwd) ||
      (resolved.startsWith(tmp + path.sep) || resolved === tmp)
    ) {
      return resolved;
    }
    throw new BrowserWorkerError(
      "INVALID_INPUT",
      `Output path "${filePath}" is outside allowed directories (cwd or tmpdir).`,
      false,
      { path: filePath },
    );
  }

  // ── Connection management ──────────────────────────────────────────────────

  private async ensureConnected(): Promise<Browser> {
    if (this.browser?.connected) return this.browser;
    try {
      this.browser = await puppeteer.connect({ browserURL: this.debuggingUrl });
      return this.browser;
    } catch (error) {
      throw new BrowserWorkerError(
        "CONNECTION_FAILED",
        `Failed to connect to Chrome at ${this.debuggingUrl}: ${(error as Error).message}`,
        true,
        { debugging_url: this.debuggingUrl }
      );
    }
  }

  private async getPage(): Promise<Page> {
    const browser = await this.ensureConnected();
    const pages = await browser.pages();
    const page = pages[0] ?? await browser.newPage();
    // Defence-in-depth: block outgoing network from evaluated scripts
    await page.setExtraHTTPHeaders({
      "Content-Security-Policy": "default-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'none'",
    });
    return page;
  }

  // ── navigate ───────────────────────────────────────────────────────────────

  async navigate(input: BrowserNavigateInput): Promise<ExecutionOutcome<BrowserNavigateOutput>> {
    const page = await this.getPage();
    const waitUntil = input.wait_until ?? "load";

    const response = await page.goto(input.url, { waitUntil });
    const status = response?.status() ?? 0;
    const title = await page.title();
    const finalUrl = page.url();

    return {
      summary: `Navigated to ${finalUrl} (status ${status}).`,
      structured_output: {
        url: finalUrl,
        title,
        status
      }
    };
  }

  // ── click ──────────────────────────────────────────────────────────────────

  async click(input: BrowserClickInput): Promise<ExecutionOutcome<BrowserClickOutput>> {
    const page = await this.getPage();

    if (input.wait_before_ms && input.wait_before_ms > 0) {
      await new Promise((resolve) => setTimeout(resolve, input.wait_before_ms));
    }

    try {
      await page.waitForSelector(input.selector, { timeout: 10_000 });
      await page.click(input.selector);
      return {
        summary: `Clicked element matching "${input.selector}".`,
        structured_output: {
          selector: input.selector,
          clicked: true
        }
      };
    } catch (error) {
      throw new BrowserWorkerError(
        "ELEMENT_NOT_FOUND",
        `Could not find or click element "${input.selector}": ${(error as Error).message}`,
        false,
        { selector: input.selector }
      );
    }
  }

  // ── type ───────────────────────────────────────────────────────────────────

  async type(input: BrowserTypeInput): Promise<ExecutionOutcome<BrowserTypeOutput>> {
    const page = await this.getPage();

    try {
      await page.waitForSelector(input.selector, { timeout: 10_000 });

      if (input.clear_first) {
        await page.click(input.selector, { count: 3 });
        await page.keyboard.press("Backspace");
        // Fallback: select all and delete in case triple-click didn't select all
        await page.keyboard.down("Control");
        await page.keyboard.press("a");
        await page.keyboard.up("Control");
        await page.keyboard.press("Backspace");
      }

      const delay = input.delay_ms ?? 0;
      await page.type(input.selector, input.text, { delay });

      return {
        summary: `Typed ${input.text.length} character(s) into "${input.selector}".`,
        structured_output: {
          selector: input.selector,
          typed: true,
          text_length: input.text.length
        }
      };
    } catch (error) {
      throw new BrowserWorkerError(
        "TYPE_FAILED",
        `Could not type into element "${input.selector}": ${(error as Error).message}`,
        false,
        { selector: input.selector }
      );
    }
  }

  // ── evaluate ───────────────────────────────────────────────────────────────

  async evaluate(input: BrowserEvaluateInput): Promise<ExecutionOutcome<BrowserEvaluateOutput>> {
    if (!input.script || typeof input.script !== "string") {
      throw new BrowserWorkerError("EVALUATE_FAILED", "Script must be a non-empty string.", false);
    }
    if (input.script.length > 50_000) {
      throw new BrowserWorkerError("EVALUATE_FAILED", `Script too large (${input.script.length} chars). Maximum is 50000.`, false);
    }
    if (!input.trusted) {
      sanitizeScript(input.script);
    }

    const page = await this.getPage();
    const timeoutMs = input.timeout_ms ?? DEFAULT_EVAL_TIMEOUT_MS;

    try {
      const args = input.args ?? [];
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const fn = new Function(...args.map((_, i) => `arg${i}`), input.script) as (...a: unknown[]) => unknown;
      const result = await Promise.race([
        page.evaluate(fn, ...args),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Script timed out after ${timeoutMs}ms`)), timeoutMs),
        ),
      ]);
      return {
        summary: "Script evaluated successfully.",
        structured_output: { result }
      };
    } catch (error) {
      throw new BrowserWorkerError(
        "EVALUATE_FAILED",
        `Script evaluation failed: ${(error as Error).message}`,
        false,
        { script_preview: input.script.slice(0, 200) }
      );
    }
  }

  // ── waitFor ────────────────────────────────────────────────────────────────

  async waitFor(input: BrowserWaitForInput): Promise<ExecutionOutcome<BrowserWaitForOutput>> {
    const page = await this.getPage();
    const timeout = input.timeout_ms ?? 30_000;
    const start = Date.now();

    try {
      await page.waitForSelector(input.selector, {
        visible: input.visible ?? false,
        timeout
      });
      const elapsed = Date.now() - start;
      return {
        summary: `Element "${input.selector}" found after ${elapsed}ms.`,
        structured_output: {
          selector: input.selector,
          found: true,
          elapsed_ms: elapsed
        }
      };
    } catch {
      throw new BrowserWorkerError(
        "ELEMENT_NOT_FOUND",
        `Element "${input.selector}" not found within ${timeout}ms.`,
        false,
        { selector: input.selector, timeout_ms: timeout }
      );
    }
  }

  // ── screenshot ─────────────────────────────────────────────────────────────

  async screenshot(input: BrowserScreenshotInput): Promise<ExecutionOutcome<BrowserScreenshotOutput>> {
    const page = await this.getPage();
    const fullPage = input.full_page ?? false;
    const outputPath = this.validateOutputPath(input.path ?? "screenshot.png");

    try {
      if (input.selector) {
        const element = await page.waitForSelector(input.selector, { timeout: 10_000 });
        if (!element) {
          throw new BrowserWorkerError(
            "ELEMENT_NOT_FOUND",
            `Element "${input.selector}" not found for screenshot.`,
            false,
            { selector: input.selector }
          );
        }
        await element.screenshot({ path: outputPath });
        const box = await element.boundingBox();
        return {
          summary: `Captured screenshot of element "${input.selector}" to ${outputPath}.`,
          structured_output: {
            path: outputPath,
            width: Math.round(box?.width ?? 0),
            height: Math.round(box?.height ?? 0)
          }
        };
      }

      await page.screenshot({ path: outputPath, fullPage });
      const viewport = page.viewport();
      return {
        summary: `Captured ${fullPage ? "full-page " : ""}screenshot to ${outputPath}.`,
        structured_output: {
          path: outputPath,
          width: viewport?.width ?? 0,
          height: viewport?.height ?? 0
        }
      };
    } catch (error) {
      if (error instanceof BrowserWorkerError) throw error;
      throw new BrowserWorkerError(
        "SCREENSHOT_FAILED",
        `Screenshot failed: ${(error as Error).message}`,
        false
      );
    }
  }

  // ── extract ────────────────────────────────────────────────────────────────

  async extract(input: BrowserExtractInput): Promise<ExecutionOutcome<BrowserExtractOutput>> {
    const page = await this.getPage();
    const format = input.format ?? "text";

    if (input.url) {
      await page.goto(input.url, { waitUntil: "domcontentloaded" });
    }

    const title = await page.title();
    const url = page.url();

    try {
      let content: string;

      if (input.selector) {
        const element = await page.waitForSelector(input.selector, { timeout: 10_000 });
        if (!element) {
          throw new BrowserWorkerError(
            "ELEMENT_NOT_FOUND",
            `Element "${input.selector}" not found for extraction.`,
            false,
            { selector: input.selector }
          );
        }

        const prop = format === "html" ? "innerHTML" : "textContent";
          content = await page.evaluate(
            `(document.querySelector(${JSON.stringify(input.selector)})?.${prop}) ?? ""`
          ) as string;
      } else {
        if (format === "html") {
          content = await page.evaluate(
            `document.documentElement.innerHTML`
          ) as string;
        } else {
          content = await page.evaluate(
            `document.body.innerText`
          ) as string;
        }
      }

      return {
        summary: `Extracted ${format} content from ${url} (${content.length} chars).`,
        structured_output: { content, format, url, title }
      };
    } catch (error) {
      if (error instanceof BrowserWorkerError) throw error;
      throw new BrowserWorkerError(
        "EXTRACT_FAILED",
        `Content extraction failed: ${(error as Error).message}`,
        false,
        { url, format }
      );
    }
  }

  // ── runTask ────────────────────────────────────────────────────────────────

  async runTask(input: BrowserRunTaskInput): Promise<ExecutionOutcome<BrowserRunTaskOutput>> {
    const page = await this.getPage();

    if (input.url) {
      await page.goto(input.url, { waitUntil: "domcontentloaded" });
    }

    let stepsCompleted = 0;
    let lastResult: unknown = null;

    if (input.steps) {
      for (const step of input.steps) {
        switch (step.action) {
          case "navigate":
            if (step.url) {
              await page.goto(step.url, { waitUntil: "domcontentloaded" });
            }
            break;
          case "click":
            if (step.selector) {
              await page.waitForSelector(step.selector, { timeout: 10_000 });
              await page.click(step.selector);
            }
            break;
          case "type":
            if (step.selector && step.value) {
              await page.waitForSelector(step.selector, { timeout: 10_000 });
              await page.type(step.selector, step.value);
            }
            break;
          case "wait":
            if (step.selector) {
              await page.waitForSelector(step.selector, { timeout: 10_000 });
            }
            break;
          case "evaluate":
            if (step.script) {
              if (typeof step.script !== "string" || step.script.length === 0) {
                throw new BrowserWorkerError("TASK_FAILED", "Step script must be a non-empty string.", false);
              }
              if (step.script.length > 50_000) {
                throw new BrowserWorkerError("TASK_FAILED", `Step script too large (${step.script.length} chars). Maximum is 50000.`, false);
              }
              if (!input.trusted_steps) {
                sanitizeScript(step.script);
              }
              // eslint-disable-next-line @typescript-eslint/no-implied-eval
              lastResult = await Promise.race([
                page.evaluate(new Function(step.script) as () => unknown),
                new Promise((_, reject) =>
                  setTimeout(() => reject(new Error("Step script timed out after 30s")), DEFAULT_EVAL_TIMEOUT_MS),
                ),
              ]);
            }
            break;
          case "screenshot":
            await page.screenshot({ path: this.validateOutputPath(step.value ?? "task-screenshot.png") });
            break;
        }
        stepsCompleted++;
      }
    }

    const title = await page.title();
    const url = page.url();

    return {
      summary: `Completed task "${input.task}" (${stepsCompleted} step(s)).`,
      structured_output: {
        task: input.task,
        steps_completed: stepsCompleted,
        result: lastResult,
        url,
        title
      }
    };
  }

  // ── download ───────────────────────────────────────────────────────────────

  async download(input: BrowserDownloadInput): Promise<ExecutionOutcome<BrowserDownloadOutput>> {
    const page = await this.getPage();
    const destPath = input.dest_path ?? "download";
    const timeout = input.timeout_ms ?? 60_000;

    // Validate download path stays within allowed directories
    const safePath = this.validateDownloadPath(destPath);

    try {
      const client = await page.createCDPSession();
      await client.send("Browser.setDownloadBehavior", {
        behavior: "allow",
        downloadPath: safePath
      });

      const response = await page.goto(input.url, { waitUntil: "networkidle2", timeout });
      const contentType = response?.headers()["content-type"] ?? "application/octet-stream";
      const contentLength = parseInt(response?.headers()["content-length"] ?? "0", 10);

      return {
        summary: `Downloaded from ${input.url} to ${safePath}.`,
        structured_output: {
          url: input.url,
          dest_path: safePath,
          size_bytes: contentLength,
          content_type: contentType
        }
      };
    } catch (error) {
      throw new BrowserWorkerError(
        "DOWNLOAD_FAILED",
        `Download failed from ${input.url}: ${(error as Error).message}`,
        true,
        { url: input.url }
      );
    }
  }
}
