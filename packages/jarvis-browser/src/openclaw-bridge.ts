import type { OpenClawConfig } from "openclaw/plugin-sdk/plugin-entry";
import {
  invokeGatewayMethod,
  type GatewayCallOptions,
  type ArtifactRef
} from "@jarvis/shared";

// ── Shared types ─────────────────────────────────────────────────────────────

export type NavigateOptions = {
  waitForSelector?: string;
  timeoutMs?: number;
};

export type PageInfo = {
  url: string;
  title: string;
  status: number;
};

export type ExtractOptions = {
  format?: "text" | "html" | "markdown";
  selector?: string;
};

export type ExtractResult = {
  content: string;
  format: string;
  url: string;
};

export type CaptureOptions = {
  fullPage?: boolean;
  selector?: string;
  format?: "png" | "jpeg";
};

export type DownloadOptions = {
  targetDir?: string;
  timeoutMs?: number;
};

export type BrowserStep = {
  action: string;
  params: Record<string, unknown>;
};

export type TaskOptions = {
  url?: string;
  task?: string;
  timeoutMs?: number;
};

export type TaskResult = {
  steps_completed: number;
  artifacts: ArtifactRef[];
  evidence: Record<string, unknown>;
};

// ── BrowserBridge interface ──────────────────────────────────────────────────

export interface BrowserBridge {
  /** Navigate to URL and return page info. */
  navigate(url: string, options?: NavigateOptions): Promise<PageInfo>;

  /** Extract content from the current page. */
  extract(selector?: string, options?: ExtractOptions): Promise<ExtractResult>;

  /** Take a screenshot and return an artifact reference. */
  capture(options?: CaptureOptions): Promise<ArtifactRef>;

  /** Download a file from URL and return an artifact reference. */
  download(url: string, options?: DownloadOptions): Promise<ArtifactRef>;

  /** Execute a multi-step browser task. */
  runTask(steps: BrowserStep[], options?: TaskOptions): Promise<TaskResult>;

  /** Close / release the browser session. */
  close(): Promise<void>;
}

// ── OpenClawBrowserBridge ────────────────────────────────────────────────────

export type OpenClawBridgeConfig = {
  openclawConfig?: OpenClawConfig;
  gatewayOverrides?: GatewayCallOptions;
};

/**
 * Browser bridge that delegates to the OpenClaw gateway.
 *
 * Every operation is translated into an `invokeGatewayMethod` call targeting
 * the gateway's browser namespace.  Artifact registration semantics
 * (artifact_id, path, path_context, etc.) are preserved by forwarding the
 * gateway response unchanged.
 */
export class OpenClawBrowserBridge implements BrowserBridge {
  private readonly config: OpenClawConfig | undefined;
  private readonly overrides: GatewayCallOptions;

  constructor(cfg: OpenClawBridgeConfig = {}) {
    this.config = cfg.openclawConfig;
    this.overrides = cfg.gatewayOverrides ?? {};
  }

  private invoke<T>(method: string, params?: unknown): Promise<T> {
    return invokeGatewayMethod<T>(method, this.config, params, this.overrides);
  }

  // ── navigate ────────────────────────────────────────────────────────────────

  async navigate(url: string, options: NavigateOptions = {}): Promise<PageInfo> {
    const result = await this.invoke<{
      url: string;
      title: string;
      status: number;
    }>("browser.navigate", {
      url,
      wait_for_selector: options.waitForSelector,
      timeout_ms: options.timeoutMs
    });
    return {
      url: result.url,
      title: result.title,
      status: result.status
    };
  }

  // ── extract ─────────────────────────────────────────────────────────────────

  async extract(
    selector?: string,
    options: ExtractOptions = {},
  ): Promise<ExtractResult> {
    const result = await this.invoke<{
      content: string;
      format: string;
      url: string;
    }>("browser.extract", {
      selector: selector ?? options.selector,
      format: options.format ?? "text"
    });
    return {
      content: result.content,
      format: result.format,
      url: result.url
    };
  }

  // ── capture ─────────────────────────────────────────────────────────────────

  async capture(options: CaptureOptions = {}): Promise<ArtifactRef> {
    return this.invoke<ArtifactRef>("browser.capture", {
      full_page: options.fullPage ?? true,
      selector: options.selector,
      format: options.format ?? "png"
    });
  }

  // ── download ────────────────────────────────────────────────────────────────

  async download(
    url: string,
    options: DownloadOptions = {},
  ): Promise<ArtifactRef> {
    return this.invoke<ArtifactRef>("browser.download", {
      url,
      target_dir: options.targetDir,
      timeout_ms: options.timeoutMs
    });
  }

  // ── runTask ─────────────────────────────────────────────────────────────────

  async runTask(
    steps: BrowserStep[],
    options: TaskOptions = {},
  ): Promise<TaskResult> {
    return this.invoke<TaskResult>("browser.run_task", {
      steps,
      url: options.url,
      task: options.task ?? "multi-step browser task",
      timeout_ms: options.timeoutMs
    });
  }

  // ── close ───────────────────────────────────────────────────────────────────

  async close(): Promise<void> {
    await this.invoke<void>("browser.close", {});
  }
}

// ── LegacyPuppeteerBridge ────────────────────────────────────────────────────

export type LegacyBridgeConfig = {
  debuggingUrl?: string;
};

/**
 * Compatibility bridge that wraps the existing direct-Puppeteer approach
 * through `@jarvis/browser-worker`'s ChromeAdapter.
 *
 * This is the fallback path while OpenClaw browser ownership is being rolled
 * out.  It imports the worker's adapter lazily to avoid pulling in Puppeteer
 * when the OpenClaw bridge is in use.
 */
export class LegacyPuppeteerBridge implements BrowserBridge {
  private readonly debuggingUrl: string;
  private adapter: LegacyAdapter | null = null;

  constructor(cfg: LegacyBridgeConfig = {}) {
    this.debuggingUrl = cfg.debuggingUrl ?? "http://127.0.0.1:9222";
  }

  /**
   * Lazy-load the adapter.  We use a runtime-only dynamic import so that
   * TypeScript does not pull the browser-worker package into this project's
   * compilation unit (which would violate rootDir boundaries).  Packages
   * without puppeteer-core installed won't fail at load time either.
   */
  private async getAdapter(): Promise<LegacyAdapter> {
    if (this.adapter) return this.adapter;
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- runtime-only dynamic import
    const workerPkg = "@jarvis/browser-worker";
    const mod = await (import(workerPkg) as Promise<{ ChromeAdapter: new (cfg: { debugging_url: string }) => LegacyAdapter }>);
    this.adapter = new mod.ChromeAdapter({ debugging_url: this.debuggingUrl });
    return this.adapter;
  }

  // ── navigate ────────────────────────────────────────────────────────────────

  async navigate(url: string, options: NavigateOptions = {}): Promise<PageInfo> {
    const adapter = await this.getAdapter();
    const outcome = await adapter.navigate({ url });

    // Optionally wait for a selector after navigation.
    if (options.waitForSelector) {
      await adapter.waitFor({
        selector: options.waitForSelector,
        timeout_ms: options.timeoutMs ?? 30_000
      });
    }

    return {
      url: outcome.structured_output.url,
      title: outcome.structured_output.title,
      status: outcome.structured_output.status
    };
  }

  // ── extract ─────────────────────────────────────────────────────────────────

  async extract(
    selector?: string,
    options: ExtractOptions = {},
  ): Promise<ExtractResult> {
    const adapter = await this.getAdapter();
    const format = options.format ?? "text";
    const outcome = await adapter.extract({
      selector: selector ?? options.selector,
      format: format === "markdown" ? "text" : format
    });
    return {
      content: outcome.structured_output.content,
      format: outcome.structured_output.format,
      url: outcome.structured_output.url
    };
  }

  // ── capture ─────────────────────────────────────────────────────────────────

  async capture(options: CaptureOptions = {}): Promise<ArtifactRef> {
    const adapter = await this.getAdapter();
    const format = options.format ?? "png";
    const path = `capture-${Date.now()}.${format}`;
    const outcome = await adapter.screenshot({
      full_page: options.fullPage ?? true,
      selector: options.selector,
      path
    });
    return {
      artifact_id: `capture-${Date.now()}`,
      path: outcome.structured_output.path,
      path_context: "local_fs"
    };
  }

  // ── download ────────────────────────────────────────────────────────────────

  async download(
    url: string,
    options: DownloadOptions = {},
  ): Promise<ArtifactRef> {
    const adapter = await this.getAdapter();
    const outcome = await adapter.download({
      url,
      dest_path: options.targetDir,
      timeout_ms: options.timeoutMs
    });
    return {
      artifact_id: `download-${Date.now()}`,
      path: outcome.structured_output.dest_path,
      path_context: "local_fs"
    };
  }

  // ── runTask ─────────────────────────────────────────────────────────────────

  async runTask(
    steps: BrowserStep[],
    options: TaskOptions = {},
  ): Promise<TaskResult> {
    const adapter = await this.getAdapter();
    const workerSteps = steps.map((step) => ({
      action: step.action as "navigate" | "click" | "type" | "wait" | "evaluate" | "screenshot",
      selector: step.params.selector as string | undefined,
      value: step.params.value as string | undefined,
      url: step.params.url as string | undefined,
      script: step.params.script as string | undefined
    }));

    const outcome = await adapter.runTask({
      task: options.task ?? "multi-step browser task",
      url: options.url,
      steps: workerSteps,
      timeout_ms: options.timeoutMs
    });

    return {
      steps_completed: outcome.structured_output.steps_completed,
      artifacts: [],
      evidence: {
        url: outcome.structured_output.url,
        title: outcome.structured_output.title,
        result: outcome.structured_output.result
      }
    };
  }

  // ── close ───────────────────────────────────────────────────────────────────

  async close(): Promise<void> {
    this.adapter = null;
  }
}

/**
 * Minimal surface of the ChromeAdapter consumed by LegacyPuppeteerBridge.
 * Keeps the bridge decoupled from the full worker type graph at compile time.
 */
type LegacyAdapter = {
  navigate(input: { url: string; wait_until?: string }): Promise<{
    structured_output: { url: string; title: string; status: number };
  }>;
  waitFor(input: { selector: string; timeout_ms?: number }): Promise<unknown>;
  extract(input: { selector?: string; format?: string }): Promise<{
    structured_output: { content: string; format: string; url: string };
  }>;
  screenshot(input: {
    full_page?: boolean;
    selector?: string;
    path?: string;
  }): Promise<{ structured_output: { path: string; width: number; height: number } }>;
  download(input: {
    url: string;
    dest_path?: string;
    timeout_ms?: number;
  }): Promise<{ structured_output: { dest_path: string } }>;
  runTask(input: {
    task: string;
    url?: string;
    steps?: Array<{
      action: string;
      selector?: string;
      value?: string;
      url?: string;
      script?: string;
    }>;
    timeout_ms?: number;
  }): Promise<{
    structured_output: {
      steps_completed: number;
      result: unknown;
      url: string;
      title: string;
    };
  }>;
};

// ── Factory ──────────────────────────────────────────────────────────────────

export type BrowserBridgeFactoryConfig = {
  openclawConfig?: OpenClawConfig;
  gatewayOverrides?: GatewayCallOptions;
  debuggingUrl?: string;
};

/**
 * Create the appropriate BrowserBridge implementation.
 *
 * Selection order:
 * 1. `JARVIS_BROWSER_MODE=openclaw`  -> {@link OpenClawBrowserBridge}
 * 2. `JARVIS_BROWSER_MODE=legacy`    -> {@link LegacyPuppeteerBridge}
 * 3. If no env var is set, default to `legacy` for backward compatibility.
 */
export function createBrowserBridge(
  cfg: BrowserBridgeFactoryConfig = {},
): BrowserBridge {
  const mode = (process.env.JARVIS_BROWSER_MODE ?? "legacy").toLowerCase();

  if (mode === "openclaw") {
    return new OpenClawBrowserBridge({
      openclawConfig: cfg.openclawConfig,
      gatewayOverrides: cfg.gatewayOverrides
    });
  }

  return new LegacyPuppeteerBridge({
    debuggingUrl: cfg.debuggingUrl
  });
}
