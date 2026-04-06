// ── browser.navigate ─────────────────────────────────────────────────────────

export type BrowserNavigateInput = {
  url: string;
  wait_until?: "load" | "domcontentloaded" | "networkidle0" | "networkidle2";
};

export type BrowserNavigateOutput = {
  url: string;
  title: string;
  status: number;
};

// ── browser.click ────────────────────────────────────────────────────────────

export type BrowserClickInput = {
  selector: string;
  wait_before_ms?: number;
};

export type BrowserClickOutput = {
  selector: string;
  clicked: boolean;
};

// ── browser.type ─────────────────────────────────────────────────────────────

export type BrowserTypeInput = {
  selector: string;
  text: string;
  clear_first?: boolean;
  delay_ms?: number;
};

export type BrowserTypeOutput = {
  selector: string;
  typed: boolean;
  text_length: number;
};

// ── browser.evaluate ─────────────────────────────────────────────────────────

export type BrowserEvaluateInput = {
  script: string;
  args?: unknown[];
};

export type BrowserEvaluateOutput = {
  result: unknown;
};

// ── browser.wait_for ─────────────────────────────────────────────────────────

export type BrowserWaitForInput = {
  selector: string;
  timeout_ms?: number;
  visible?: boolean;
};

export type BrowserWaitForOutput = {
  selector: string;
  found: boolean;
  elapsed_ms: number;
};

// ── browser.capture (screenshot) ─────────────────────────────────────────────

export type BrowserScreenshotInput = {
  full_page?: boolean;
  path?: string;
  selector?: string;
};

export type BrowserScreenshotOutput = {
  path: string;
  width: number;
  height: number;
};

// ── browser.extract ──────────────────────────────────────────────────────────

export type BrowserExtractInput = {
  url?: string;
  selector?: string;
  format?: "text" | "html" | "markdown";
};

export type BrowserExtractOutput = {
  content: string;
  format: string;
  url: string;
  title: string;
};

// ── browser.run_task ─────────────────────────────────────────────────────────

export type BrowserRunTaskInput = {
  task: string;
  url?: string;
  steps?: BrowserTaskStep[];
  timeout_ms?: number;
};

export type BrowserTaskStep = {
  action: "navigate" | "click" | "type" | "wait" | "evaluate" | "screenshot";
  selector?: string;
  value?: string;
  url?: string;
  script?: string;
};

export type BrowserRunTaskOutput = {
  task: string;
  steps_completed: number;
  result: unknown;
  url: string;
  title: string;
};

// ── browser.download ─────────────────────────────────────────────────────────

export type BrowserDownloadInput = {
  url: string;
  dest_path?: string;
  timeout_ms?: number;
};

export type BrowserDownloadOutput = {
  url: string;
  dest_path: string;
  size_bytes: number;
  content_type: string;
};
