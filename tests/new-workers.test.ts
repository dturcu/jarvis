import { beforeEach, describe, expect, it } from "vitest";
import { CONTRACT_VERSION } from "@jarvis/shared";
import type { JobEnvelope } from "@jarvis/shared";

// ── Office Worker ────────────────────────────────────────────────────────────
import {
  MockOfficeAdapter,
  createMockOfficeAdapter,
  createOfficeWorker,
  OFFICE_JOB_TYPES,
  OFFICE_WORKER_ID,
  MOCK_NOW as OFFICE_MOCK_NOW,
} from "@jarvis/office-worker";

// ── Interpreter Worker ──────────────────────────────────────────────────────
import {
  MockInterpreterAdapter,
  createMockInterpreterAdapter,
  createInterpreterWorker,
  RealInterpreterAdapter,
  createRealInterpreterAdapter,
  INTERPRETER_WORKER_ID,
  INTERPRETER_JOB_TYPES,
} from "@jarvis/interpreter-worker";

// ── Browser Worker ──────────────────────────────────────────────────────────
import {
  MockBrowserAdapter,
  createMockBrowserAdapter,
  createBrowserWorker,
  BROWSER_JOB_TYPES,
  BROWSER_WORKER_ID,
} from "@jarvis/browser-worker";

// ── Social Worker ───────────────────────────────────────────────────────────
import {
  MockSocialAdapter,
  createMockSocialAdapter,
  createSocialWorker,
  SOCIAL_JOB_TYPES,
  SOCIAL_WORKER_ID,
} from "@jarvis/social-worker";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeEnvelope(
  type: string,
  input: Record<string, unknown> = {},
  overrides: Partial<JobEnvelope> = {},
): JobEnvelope {
  return {
    contract_version: CONTRACT_VERSION,
    job_id: `test-${Math.random().toString(36).slice(2)}`,
    type: type as JobEnvelope["type"],
    session_key: "agent:test:api:local:adhoc",
    requested_by: { channel: "api", user_id: "test-user" },
    priority: "normal",
    approval_state: "not_required",
    timeout_seconds: 60,
    attempt: 1,
    input,
    artifacts_in: [],
    metadata: {
      agent_id: "test",
      thread_key: null,
    },
    ...overrides,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// OFFICE WORKER
// ═════════════════════════════════════════════════════════════════════════════

describe("Office Worker via Mock", () => {
  let adapter: MockOfficeAdapter;
  let worker: ReturnType<typeof createOfficeWorker>;

  beforeEach(() => {
    adapter = new MockOfficeAdapter();
    worker = createOfficeWorker({ adapter });
  });

  it("routes office.inspect correctly", async () => {
    const env = makeEnvelope("office.inspect", {
      target_artifacts: [{ artifact_id: "art-1" }],
      inspect_mode: "auto",
      output_mode: "summary",
    });
    const result = await worker.execute(env);
    expect(result.status).toBe("completed");
    expect(result.job_type).toBe("office.inspect");
    const output = result.structured_output as Record<string, unknown>;
    expect(output.files).toBeDefined();
    expect(Array.isArray(output.files)).toBe(true);
  });

  it("routes office.merge_excel correctly", async () => {
    const env = makeEnvelope("office.merge_excel", {
      files: [{ artifact_id: "a1" }, { artifact_id: "a2" }],
      mode: "by_header_union",
      sheet_policy: "first_sheet",
      dedupe: { enabled: true, keys: ["Name"] },
      output_name: "merged.xlsx",
    });
    const result = await worker.execute(env);
    expect(result.status).toBe("completed");
    const output = result.structured_output as Record<string, unknown>;
    expect(output.output_name).toBe("merged.xlsx");
    expect(output.sheets_merged).toBe(4);
    expect(output.duplicates_removed).toBe(15);
  });

  it("routes office.transform_excel correctly", async () => {
    const env = makeEnvelope("office.transform_excel", {
      source_artifact: { artifact_id: "src-1" },
      output_name: "transformed.xlsx",
      sheet_mode: "all_sheets",
      rename_columns: { old_col: "new_col" },
      select_columns: ["A", "B"],
    });
    const result = await worker.execute(env);
    expect(result.status).toBe("completed");
    const output = result.structured_output as Record<string, unknown>;
    expect(output.output_name).toBe("transformed.xlsx");
    expect(output.sheets_processed).toBe(3);
    expect(output.columns_renamed).toBe(1);
    expect(output.columns_selected).toBe(2);
  });

  it("routes office.fill_docx correctly", async () => {
    const env = makeEnvelope("office.fill_docx", {
      template_artifact_id: "tpl-1",
      variables: { name: "Daniel", company: "TiC" },
      strict_variables: true,
      output_name: "filled.docx",
    });
    const result = await worker.execute(env);
    expect(result.status).toBe("completed");
    const output = result.structured_output as Record<string, unknown>;
    expect(output.variables_filled).toBe(2);
    expect(output.output_name).toBe("filled.docx");
  });

  it("routes office.build_pptx correctly", async () => {
    const env = makeEnvelope("office.build_pptx", {
      source: { slides: [{ title: "Slide 1" }, { title: "Slide 2" }] },
      theme: "corporate_clean",
      speaker_notes: true,
      output_name: "deck.pptx",
    });
    const result = await worker.execute(env);
    expect(result.status).toBe("completed");
    const output = result.structured_output as Record<string, unknown>;
    expect(output.slide_count).toBe(2);
    expect(output.theme).toBe("corporate_clean");
    expect(output.has_speaker_notes).toBe(true);
  });

  it("routes office.extract_tables correctly", async () => {
    const env = makeEnvelope("office.extract_tables", {
      source_artifact: { artifact_id: "doc-1" },
      format: "json",
      output_name: "tables.json",
    });
    const result = await worker.execute(env);
    expect(result.status).toBe("completed");
    const output = result.structured_output as Record<string, unknown>;
    expect(output.total_tables).toBe(1);
    expect(output.format).toBe("json");
  });

  it("routes office.preview correctly", async () => {
    const env = makeEnvelope("office.preview", {
      source_artifact: { artifact_id: "prev-1" },
      format: "text",
      output_name: "preview.txt",
    });
    const result = await worker.execute(env);
    expect(result.status).toBe("completed");
    const output = result.structured_output as Record<string, unknown>;
    expect(output.truncated).toBe(false);
    expect(typeof output.content).toBe("string");
  });

  it("returns failed result for unknown job type", async () => {
    const env = makeEnvelope("office.unknown_action", {});
    const result = await worker.execute(env);
    expect(result.status).toBe("failed");
    expect(result.error).toBeDefined();
    expect(result.error!.code).toBe("INVALID_INPUT");
  });

  it("mock adapter tracks inspect calls", async () => {
    const input = {
      target_artifacts: [{ artifact_id: "x" }],
      inspect_mode: "auto",
      output_mode: "json",
    };
    await adapter.inspect(input as any);
    expect(adapter.getInspectCalls()).toHaveLength(1);
    expect(adapter.getInspectCalls()[0]!.target_artifacts[0]!.artifact_id).toBe("x");
  });

  it("mock adapter tracks merge calls", async () => {
    const input = {
      files: [{ artifact_id: "f1" }],
      mode: "append_rows_by_sheet",
      sheet_policy: "all_sheets",
      dedupe: { enabled: false },
      output_name: "out.xlsx",
    };
    await adapter.mergeExcel(input as any);
    expect(adapter.getMergeCalls()).toHaveLength(1);
  });

  it("each method returns ExecutionOutcome with summary and structured_output", async () => {
    const inspectResult = await adapter.inspect({
      target_artifacts: [{ artifact_id: "a1" }],
      inspect_mode: "auto",
      output_mode: "summary",
    });
    expect(typeof inspectResult.summary).toBe("string");
    expect(inspectResult.structured_output).toBeDefined();
    expect(inspectResult.structured_output.inspected_at).toBe(OFFICE_MOCK_NOW);

    const previewResult = await adapter.preview({
      source_artifact: { artifact_id: "p1" },
      format: "text",
      output_name: "prev.txt",
    });
    expect(typeof previewResult.summary).toBe("string");
    expect(previewResult.structured_output.previewed_at).toBe(OFFICE_MOCK_NOW);
  });

  it("completed result contains contract_version and metrics", async () => {
    const env = makeEnvelope("office.inspect", {
      target_artifacts: [{ artifact_id: "a1" }],
      inspect_mode: "auto",
      output_mode: "summary",
    });
    const result = await worker.execute(env);
    expect(result.contract_version).toBe(CONTRACT_VERSION);
    expect(result.metrics).toBeDefined();
    expect(result.metrics!.worker_id).toBe(OFFICE_WORKER_ID);
    expect(result.attempt).toBe(1);
  });

  it("worker ID defaults to OFFICE_WORKER_ID", () => {
    expect(worker.workerId).toBe(OFFICE_WORKER_ID);
  });

  it("accepts a custom worker ID", () => {
    const custom = createOfficeWorker({ adapter, workerId: "custom-office" });
    expect(custom.workerId).toBe("custom-office");
  });

  it("tracks all call types independently", async () => {
    await adapter.inspect({ target_artifacts: [{ artifact_id: "i1" }], inspect_mode: "auto", output_mode: "summary" });
    await adapter.fillDocx({ template_artifact_id: "t1", variables: { x: 1 }, strict_variables: false, output_name: "f.docx" });
    await adapter.buildPptx({ source: {}, theme: "minimal_light", speaker_notes: false, output_name: "p.pptx" });

    expect(adapter.getInspectCalls()).toHaveLength(1);
    expect(adapter.getFillDocxCalls()).toHaveLength(1);
    expect(adapter.getBuildPptxCalls()).toHaveLength(1);
    expect(adapter.getMergeCalls()).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// INTERPRETER WORKER — RealInterpreterAdapter
// ═════════════════════════════════════════════════════════════════════════════

describe("Interpreter Worker — RealInterpreterAdapter", () => {
  let adapter: RealInterpreterAdapter;

  beforeEach(() => {
    adapter = new RealInterpreterAdapter();
  });

  it("runCode executes JavaScript via node -e", async () => {
    const result = await adapter.runCode({
      language: "javascript",
      code: "console.log('hello from node')",
      timeout_seconds: 10,
    });
    expect(result.structured_output.exit_code).toBe(0);
    expect(result.structured_output.stdout).toContain("hello from node");
  });

  it("runCode captures stdout correctly", async () => {
    const result = await adapter.runCode({
      language: "javascript",
      code: "process.stdout.write('lineA\\nlineB')",
      timeout_seconds: 10,
    });
    expect(result.structured_output.stdout).toContain("lineA");
    expect(result.structured_output.stdout).toContain("lineB");
  });

  it("runCode captures stderr correctly", async () => {
    const result = await adapter.runCode({
      language: "javascript",
      code: "console.error('error-msg')",
      timeout_seconds: 10,
    });
    expect(result.structured_output.stderr).toContain("error-msg");
    expect(result.structured_output.exit_code).toBe(0);
  });

  it("runCode returns exit code 0 on success", async () => {
    const result = await adapter.runCode({
      language: "javascript",
      code: "console.log('ok')",
      timeout_seconds: 10,
    });
    expect(result.structured_output.exit_code).toBe(0);
  });

  it("runCode returns non-zero exit code on failure", async () => {
    const result = await adapter.runCode({
      language: "javascript",
      code: "process.exit(42)",
      timeout_seconds: 10,
    });
    expect(result.structured_output.exit_code).toBe(42);
  });

  it("runCode enforces timeout", async () => {
    const result = await adapter.runCode({
      language: "javascript",
      code: "setTimeout(() => {}, 60000)",
      timeout_seconds: 1,
    });
    // exit_code 124 indicates timeout
    expect(result.structured_output.exit_code).toBe(124);
    expect(result.structured_output.stderr).toContain("timed out");
  }, 10_000);

  it("runCode handles shell commands", async () => {
    // On Windows, the real adapter routes shell to PowerShell
    const isWindows = process.platform === "win32";
    const code = isWindows ? "Write-Output 'shell-test'" : "echo 'shell-test'";

    const result = await adapter.runCode({
      language: "shell",
      code,
      timeout_seconds: 10,
    });
    expect(result.structured_output.exit_code).toBe(0);
    expect(result.structured_output.stdout).toContain("shell-test");
  });

  it("runCode returns execution_time_ms", async () => {
    const result = await adapter.runCode({
      language: "javascript",
      code: "console.log(1)",
      timeout_seconds: 10,
    });
    expect(typeof result.structured_output.execution_time_ms).toBe("number");
    expect(result.structured_output.execution_time_ms).toBeGreaterThanOrEqual(0);
  });

  it("status returns empty sessions initially", async () => {
    const result = await adapter.status({});
    expect(result.structured_output.active_sessions).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// INTERPRETER WORKER — MockInterpreterAdapter
// ═════════════════════════════════════════════════════════════════════════════

describe("Interpreter Worker — MockInterpreterAdapter", () => {
  let adapter: MockInterpreterAdapter;
  let worker: ReturnType<typeof createInterpreterWorker>;

  beforeEach(() => {
    adapter = new MockInterpreterAdapter();
    worker = createInterpreterWorker({ adapter });
  });

  it("routes interpreter.run_code correctly", async () => {
    const env = makeEnvelope("interpreter.run_code", {
      language: "javascript",
      code: "console.log('hi')",
      timeout_seconds: 30,
    });
    const result = await worker.execute(env);
    expect(result.status).toBe("completed");
    expect(result.job_type).toBe("interpreter.run_code");
    const output = result.structured_output as Record<string, unknown>;
    expect(output.exit_code).toBe(0);
  });

  it("routes interpreter.run_task correctly", async () => {
    const env = makeEnvelope("interpreter.run_task", {
      task: "Create a test file",
      auto_approve: true,
    });
    const result = await worker.execute(env);
    expect(result.status).toBe("completed");
    expect(result.job_type).toBe("interpreter.run_task");
    const output = result.structured_output as Record<string, unknown>;
    expect(output.session_id).toBeDefined();
    expect(Array.isArray(output.steps)).toBe(true);
  });

  it("routes interpreter.status correctly", async () => {
    const env = makeEnvelope("interpreter.status", {});
    const result = await worker.execute(env);
    expect(result.status).toBe("completed");
    const output = result.structured_output as Record<string, unknown>;
    expect(output.active_sessions).toBeDefined();
  });

  it("mock tracks runCode calls", async () => {
    await adapter.runCode({ language: "python", code: "print(1)", timeout_seconds: 10 });
    await adapter.runCode({ language: "javascript", code: "1+1", timeout_seconds: 5 });
    expect(adapter.getRunCodeCalls()).toHaveLength(2);
    expect(adapter.getRunCodeCalls()[0]!.language).toBe("python");
  });

  it("mock tracks runTask calls", async () => {
    await adapter.runTask({ task: "do thing", auto_approve: false });
    expect(adapter.getRunTaskCalls()).toHaveLength(1);
    expect(adapter.getRunTaskCalls()[0]!.task).toBe("do thing");
  });

  it("failed execution returns proper error structure for unknown type", async () => {
    const env = makeEnvelope("interpreter.bogus", {});
    const result = await worker.execute(env);
    expect(result.status).toBe("failed");
    expect(result.error).toBeDefined();
    expect(result.error!.code).toBe("INVALID_INPUT");
    expect(result.error!.retryable).toBe(false);
  });

  it("worker ID defaults to INTERPRETER_WORKER_ID", () => {
    expect(worker.workerId).toBe(INTERPRETER_WORKER_ID);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// BROWSER WORKER
// ═════════════════════════════════════════════════════════════════════════════

describe("Browser Worker via Mock", () => {
  let adapter: MockBrowserAdapter;
  let worker: ReturnType<typeof createBrowserWorker>;

  beforeEach(() => {
    adapter = new MockBrowserAdapter();
    worker = createBrowserWorker({ adapter });
  });

  it("routes browser.navigate correctly", async () => {
    const env = makeEnvelope("browser.navigate", {
      url: "https://example.com",
      wait_until: "load",
    });
    const result = await worker.execute(env);
    expect(result.status).toBe("completed");
    const output = result.structured_output as Record<string, unknown>;
    expect(output.url).toBe("https://example.com");
    expect(output.status).toBe(200);
  });

  it("routes browser.click correctly", async () => {
    adapter.seedSelector("#btn");
    const env = makeEnvelope("browser.click", { selector: "#btn" });
    const result = await worker.execute(env);
    expect(result.status).toBe("completed");
    const output = result.structured_output as Record<string, unknown>;
    expect(output.clicked).toBe(true);
  });

  it("routes browser.type correctly", async () => {
    adapter.seedSelector("#input");
    const env = makeEnvelope("browser.type", {
      selector: "#input",
      text: "hello",
      clear_first: true,
    });
    const result = await worker.execute(env);
    expect(result.status).toBe("completed");
    const output = result.structured_output as Record<string, unknown>;
    expect(output.typed).toBe(true);
    expect(output.text_length).toBe(5);
  });

  it("routes browser.evaluate correctly", async () => {
    const env = makeEnvelope("browser.evaluate", {
      script: "document.title",
    });
    const result = await worker.execute(env);
    expect(result.status).toBe("completed");
    const output = result.structured_output as Record<string, unknown>;
    expect(output.result).toBeNull();
  });

  it("routes browser.wait_for correctly", async () => {
    adapter.seedSelector(".loader");
    const env = makeEnvelope("browser.wait_for", {
      selector: ".loader",
      timeout_ms: 5000,
    });
    const result = await worker.execute(env);
    expect(result.status).toBe("completed");
    const output = result.structured_output as Record<string, unknown>;
    expect(output.found).toBe(true);
    expect(output.elapsed_ms).toBe(0);
  });

  it("routes browser.capture correctly", async () => {
    const env = makeEnvelope("browser.capture", {
      full_page: true,
      path: "test-screenshot.png",
    });
    const result = await worker.execute(env);
    expect(result.status).toBe("completed");
    const output = result.structured_output as Record<string, unknown>;
    expect(output.path).toBe("test-screenshot.png");
    expect(output.width).toBe(1280);
    expect(output.height).toBe(720);
  });

  it("routes browser.extract correctly", async () => {
    adapter.seedPage("https://docs.example.com", "Docs Page", "Documentation content");
    const env = makeEnvelope("browser.extract", {
      format: "text",
    });
    const result = await worker.execute(env);
    expect(result.status).toBe("completed");
    const output = result.structured_output as Record<string, unknown>;
    expect(output.content).toBe("Documentation content");
    expect(output.url).toBe("https://docs.example.com");
  });

  it("seedPage sets current URL and title", () => {
    adapter.seedPage("https://test.dev", "Test Dev");
    expect(adapter.getPageUrl()).toBe("https://test.dev");
    expect(adapter.getPageTitle()).toBe("Test Dev");
  });

  it("seedSelector makes click succeed", async () => {
    adapter.seedSelector("button.submit", "Submit");
    const result = await adapter.click({ selector: "button.submit" });
    expect(result.structured_output.clicked).toBe(true);
  });

  it("seedSelector makes waitFor find the element", async () => {
    adapter.seedSelector(".status");
    const result = await adapter.waitFor({ selector: ".status" });
    expect(result.structured_output.found).toBe(true);
  });

  it("click on unseeded selector throws BrowserWorkerError", async () => {
    const env = makeEnvelope("browser.click", { selector: "#nonexistent" });
    const result = await worker.execute(env);
    expect(result.status).toBe("failed");
    expect(result.error).toBeDefined();
    expect(result.error!.code).toBe("ELEMENT_NOT_FOUND");
  });

  it("records action history", async () => {
    await adapter.navigate({ url: "https://a.com" });
    adapter.seedSelector("#x");
    await adapter.click({ selector: "#x" });
    await adapter.screenshot({});

    const actions = adapter.getActions();
    expect(actions).toHaveLength(3);
    expect(actions[0]!.method).toBe("navigate");
    expect(actions[1]!.method).toBe("click");
    expect(actions[2]!.method).toBe("screenshot");
  });

  it("getActions returns all recorded actions", async () => {
    expect(adapter.getActions()).toHaveLength(0);
    await adapter.evaluate({ script: "1+1" });
    expect(adapter.getActions()).toHaveLength(1);
    expect(adapter.getActionCount()).toBe(1);
  });

  it("returns failure for unknown job type", async () => {
    const env = makeEnvelope("browser.unknown", {});
    const result = await worker.execute(env);
    expect(result.status).toBe("failed");
    expect(result.error!.code).toBe("INVALID_INPUT");
  });

  it("worker ID defaults to BROWSER_WORKER_ID", () => {
    expect(worker.workerId).toBe(BROWSER_WORKER_ID);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SOCIAL WORKER
// ═════════════════════════════════════════════════════════════════════════════

describe("Social Worker via Mock", () => {
  let adapter: MockSocialAdapter;
  let worker: ReturnType<typeof createSocialWorker>;

  beforeEach(() => {
    adapter = new MockSocialAdapter();
    worker = createSocialWorker({ adapter });
  });

  it("routes social.like correctly", async () => {
    const env = makeEnvelope("social.like", {
      platform: "linkedin",
      post_url: "https://linkedin.com/feed/update/urn:li:activity:1234",
    });
    const result = await worker.execute(env);
    expect(result.status).toBe("completed");
    const output = result.structured_output as Record<string, unknown>;
    expect(output.liked).toBe(true);
    expect(output.platform).toBe("linkedin");
  });

  it("routes social.comment correctly", async () => {
    const env = makeEnvelope("social.comment", {
      platform: "twitter",
      post_url: "https://x.com/user/status/12345",
      text: "Great insight!",
    });
    const result = await worker.execute(env);
    expect(result.status).toBe("completed");
    const output = result.structured_output as Record<string, unknown>;
    expect(output.commented).toBe(true);
    expect(output.text).toBe("Great insight!");
  });

  it("routes social.repost correctly", async () => {
    const env = makeEnvelope("social.repost", {
      platform: "linkedin",
      post_url: "https://linkedin.com/feed/update/urn:li:activity:5678",
      quote_text: "Sharing this",
    });
    const result = await worker.execute(env);
    expect(result.status).toBe("completed");
    const output = result.structured_output as Record<string, unknown>;
    expect(output.reposted).toBe(true);
  });

  it("routes social.post correctly", async () => {
    const env = makeEnvelope("social.post", {
      platform: "linkedin",
      text: "New blog post about ISO 26262",
    });
    const result = await worker.execute(env);
    expect(result.status).toBe("completed");
    const output = result.structured_output as Record<string, unknown>;
    expect(output.posted).toBe(true);
    expect(typeof output.post_url).toBe("string");
  });

  it("routes social.follow correctly", async () => {
    const env = makeEnvelope("social.follow", {
      platform: "github",
      profile_url: "https://github.com/autosar-contributor",
    });
    const result = await worker.execute(env);
    expect(result.status).toBe("completed");
    const output = result.structured_output as Record<string, unknown>;
    expect(output.followed).toBe(true);
    expect(output.platform).toBe("github");
  });

  it("routes social.scan_feed correctly", async () => {
    const env = makeEnvelope("social.scan_feed", {
      platform: "linkedin",
      max_posts: 5,
    });
    const result = await worker.execute(env);
    expect(result.status).toBe("completed");
    const output = result.structured_output as Record<string, unknown>;
    expect(output.platform).toBe("linkedin");
    expect(Array.isArray(output.posts)).toBe(true);
  });

  it("routes social.digest correctly", async () => {
    // First perform some actions to populate digest
    await adapter.like({ platform: "linkedin", post_url: "https://linkedin.com/post/1" });
    await adapter.comment({
      platform: "twitter",
      post_url: "https://x.com/user/status/1",
      text: "Nice!",
    });

    const env = makeEnvelope("social.digest", { period: "session" });
    const result = await worker.execute(env);
    expect(result.status).toBe("completed");
    const output = result.structured_output as Record<string, unknown>;
    expect(output.total_actions).toBe(2);
  });

  it("mock adapter returns platform-specific scan_feed responses", async () => {
    const linkedInResult = await adapter.scanFeed({ platform: "linkedin" });
    expect(linkedInResult.structured_output.posts.length).toBeGreaterThan(0);
    expect(linkedInResult.structured_output.platform).toBe("linkedin");

    const githubResult = await adapter.scanFeed({ platform: "github" });
    expect(githubResult.structured_output.platform).toBe("github");
    expect(githubResult.structured_output.posts.length).toBeGreaterThan(0);
  });

  it("mock tracks actions", async () => {
    await adapter.like({ platform: "linkedin", post_url: "https://linkedin.com/p/1" });
    await adapter.follow({ platform: "twitter", profile_url: "https://x.com/user1" });
    expect(adapter.getActions()).toHaveLength(2);
    expect(adapter.getActionCount()).toBe(2);
  });

  it("getActions returns action history", async () => {
    expect(adapter.getActions()).toHaveLength(0);
    await adapter.like({ platform: "reddit", post_url: "https://reddit.com/r/post/1" });
    const actions = adapter.getActions();
    expect(actions).toHaveLength(1);
    expect(actions[0]!.method).toBe("like");
  });

  it("getActionsByPlatform filters correctly", async () => {
    await adapter.like({ platform: "linkedin", post_url: "https://linkedin.com/p/1" });
    await adapter.comment({ platform: "twitter", post_url: "https://x.com/s/1", text: "hi" });
    await adapter.follow({ platform: "linkedin", profile_url: "https://linkedin.com/in/user" });

    const linkedInActions = adapter.getActionsByPlatform("linkedin");
    expect(linkedInActions).toHaveLength(2);

    const twitterActions = adapter.getActionsByPlatform("twitter");
    expect(twitterActions).toHaveLength(1);

    const githubActions = adapter.getActionsByPlatform("github");
    expect(githubActions).toHaveLength(0);
  });

  it("each SocialPlatform type works", async () => {
    const platforms = ["linkedin", "twitter", "github", "reddit", "facebook"] as const;

    for (const platform of platforms) {
      const result = await adapter.like({
        platform,
        post_url: `https://${platform}.com/post/1`,
      });
      expect(result.structured_output.liked).toBe(true);
      expect(result.structured_output.platform).toBe(platform);
    }

    expect(adapter.getActionCount()).toBe(5);
  });

  it("returns failure for unknown job type", async () => {
    const env = makeEnvelope("social.unknown", {});
    const result = await worker.execute(env);
    expect(result.status).toBe("failed");
    expect(result.error!.code).toBe("INVALID_INPUT");
  });

  it("worker ID defaults to SOCIAL_WORKER_ID", () => {
    expect(worker.workerId).toBe(SOCIAL_WORKER_ID);
  });

  it("scan_feed respects filter_keywords", async () => {
    const result = await adapter.scanFeed({
      platform: "linkedin",
      filter_keywords: ["AUTOSAR"],
    });
    const posts = result.structured_output.posts;
    expect(posts.length).toBeGreaterThan(0);
    for (const post of posts) {
      expect(post.text_preview.toLowerCase()).toContain("autosar");
    }
  });
});
