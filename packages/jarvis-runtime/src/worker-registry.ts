import { randomUUID } from "node:crypto";
import type { JobEnvelope, JobResult, JarvisJobType } from "@jarvis/shared";
import { JOB_TIMEOUT_SECONDS } from "@jarvis/shared";
import { createInferenceWorker } from "@jarvis/inference-worker";
import { MockInferenceAdapter, DefaultInferenceAdapter } from "@jarvis/inference-worker";
import { createEmailWorker, MockEmailAdapter, GmailAdapter } from "@jarvis/email-worker";
import { createDocumentWorker, MockDocumentAdapter, RealDocumentAdapter } from "@jarvis/document-worker";
import { createCrmWorker, MockCrmAdapter, SqliteCrmAdapter } from "@jarvis/crm-worker";
import { createWebWorker, MockWebAdapter, RealWebAdapter } from "@jarvis/web-worker";
import { createCalendarWorker, MockCalendarAdapter, GoogleCalendarAdapter } from "@jarvis/calendar-worker";
import { createDesktopHostWorker, PowerShellDesktopHostAdapter, MockDesktopHostAdapter } from "@jarvis/desktop-host-worker";
import { createBrowserWorker, ChromeAdapter, MockBrowserAdapter } from "@jarvis/browser-worker";
import { createSocialWorker, BrowserSocialAdapter, MockSocialAdapter } from "@jarvis/social-worker";
import { createSystemWorker, NodeSystemAdapter, MockSystemAdapter } from "@jarvis/system-worker";
import { createOfficeWorker, RealOfficeAdapter, MockOfficeAdapter } from "@jarvis/office-worker";
import { createInterpreterWorker, RealInterpreterAdapter, MockInterpreterAdapter } from "@jarvis/interpreter-worker";
import { createVoiceWorker, RealVoiceAdapter, MockVoiceAdapter } from "@jarvis/voice-worker";
import { createSecurityWorker, RealSecurityAdapter, MockSecurityAdapter } from "@jarvis/security-worker";
import { createTimeWorker, TogglAdapter, MockTimeAdapter } from "@jarvis/time-worker";
import { createDriveWorker, GoogleDriveAdapter, MockDriveAdapter } from "@jarvis/drive-worker";
import { createFilesWorkerBridge } from "./files-bridge.js";
import { loadFilesystemPolicy } from "./filesystem-policy.js";
import { getExecutionPolicy } from "./execution-policy.js";
import type { WorkerHealthMonitor } from "./worker-health.js";
import { CRM_DB_PATH, type JarvisRuntimeConfig } from "./config.js";
import type { Logger } from "./logger.js";
import type { DatabaseSync } from "node:sqlite";

type WorkerExecuteFn = (envelope: JobEnvelope) => Promise<JobResult>;

export type WorkerRegistry = {
  executeJob(envelope: JobEnvelope): Promise<JobResult>;
  /** Simple convenience: call inference.chat and return the text content */
  chat(userPrompt: string, systemPrompt?: string): Promise<string>;
  /** Get the health monitor if available */
  getHealthMonitor(): WorkerHealthMonitor | undefined;
};

export type WorkerRegistryOptions = {
  embeddingPipeline?: import("@jarvis/agent-framework").EmbeddingPipeline;
  hybridRetriever?: import("@jarvis/agent-framework").HybridRetriever;
};

export function createWorkerRegistry(
  config: JarvisRuntimeConfig,
  logger: Logger,
  runtimeDb?: DatabaseSync,
  healthMonitor?: WorkerHealthMonitor,
  opts?: WorkerRegistryOptions,
): WorkerRegistry {
  const useReal = config.adapter_mode === "real";

  // Audit helper: log credential access for security trail (best-effort)
  const auditCredentialAccess = (workerId: string, credentialType: string) => {
    if (!runtimeDb) return;
    try {
      runtimeDb.prepare(
        "INSERT INTO audit_log (event_type, actor, target, details_json, created_at) VALUES (?, ?, ?, ?, ?)"
      ).run("credential_access", "worker-registry", workerId, JSON.stringify({ credential_type: credentialType }), new Date().toISOString());
    } catch { /* best-effort — audit table may not exist yet */ }
  };

  // ─── Inference ──────────────────────────────────────────────────────────
  const inferenceAdapter = useReal
    ? new DefaultInferenceAdapter(runtimeDb, config.lmstudio_url, opts?.embeddingPipeline, opts?.hybridRetriever)
    : new MockInferenceAdapter();
  const inferenceWorker = createInferenceWorker({ adapter: inferenceAdapter });

  // Chat helper for adapters that need LLM access.
  // Uses evidence-backed model routing when runtimeDb is available.
  const chatFn = async (prompt: string, systemPrompt?: string, profile?: { objective: string }): Promise<string> => {
    const messages: Array<{ role: string; content: string }> = [];
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({ role: "user", content: prompt });

    let model = config.default_model === "auto" ? undefined : config.default_model;

    // Evidence-backed routing: select model from registry + benchmarks
    if (!model && runtimeDb) {
      try {
        const { loadRegisteredModels } = await import("@jarvis/inference");
        const { loadAllBenchmarks } = await import("@jarvis/inference");
        const { selectByProfileWithEvidence } = await import("@jarvis/inference");

        const registered = loadRegisteredModels(runtimeDb);
        if (registered.length > 0) {
          const benchmarks = loadAllBenchmarks(runtimeDb);
          const taskProfile = {
            objective: (profile?.objective ?? "answer") as any,
          };
          const selected = selectByProfileWithEvidence(registered, taskProfile, benchmarks);
          if (selected) {
            model = selected.id;
            logger.debug(`Evidence-based model selection: ${selected.id} (${selected.runtime})`);
          }
        }
      } catch {
        // Fall through to default — inference package may not have registry functions
      }
    }

    const envelope = buildEnvelope("inference.chat", {
      messages,
      model,
      temperature: 0.3,
      max_tokens: 2048,
    });
    const result = await inferenceWorker.execute(envelope);
    if (result.status === "failed") throw new Error(result.error?.message ?? result.summary);
    return (result.structured_output as { content?: string })?.content ?? result.summary;
  };

  // ─── Email ──────────────────────────────────────────────────────────────
  let emailAdapter;
  if (useReal && config.gmail) {
    logger.info("Email: using Gmail API adapter");
    emailAdapter = new GmailAdapter(config.gmail);
    auditCredentialAccess("email", "gmail");
  } else {
    logger.info("Email: using mock adapter");
    emailAdapter = new MockEmailAdapter();
  }
  const emailWorker = createEmailWorker({ adapter: emailAdapter });

  // ─── CRM ────────────────────────────────────────────────────────────────
  let crmAdapter;
  if (useReal) {
    logger.info("CRM: using SQLite adapter");
    crmAdapter = new SqliteCrmAdapter(CRM_DB_PATH);
  } else {
    logger.info("CRM: using mock adapter");
    crmAdapter = new MockCrmAdapter();
  }
  const crmWorker = createCrmWorker({ adapter: crmAdapter });

  // ─── Document ───────────────────────────────────────────────────────────
  let documentAdapter;
  if (useReal) {
    logger.info("Document: using real adapter (pdf-parse + mammoth + LLM)");
    documentAdapter = new RealDocumentAdapter(chatFn);
  } else {
    logger.info("Document: using mock adapter");
    documentAdapter = new MockDocumentAdapter();
  }
  const documentWorker = createDocumentWorker({ adapter: documentAdapter });

  // ─── Web ────────────────────────────────────────────────────────────────
  let webAdapter;
  if (useReal) {
    logger.info("Web: using real adapter (HTTP + LLM)");
    webAdapter = new RealWebAdapter(chatFn);
  } else {
    logger.info("Web: using mock adapter");
    webAdapter = new MockWebAdapter();
  }
  const webWorker = createWebWorker({ adapter: webAdapter });

  // ─── Calendar ───────────────────────────────────────────────────────────
  let calendarAdapter;
  if (useReal && config.calendar) {
    logger.info("Calendar: using Google Calendar API adapter");
    calendarAdapter = new GoogleCalendarAdapter(config.calendar);
    auditCredentialAccess("calendar", "calendar");
  } else {
    logger.info("Calendar: using mock adapter");
    calendarAdapter = new MockCalendarAdapter();
  }
  const calendarWorker = createCalendarWorker({ adapter: calendarAdapter });

  // ─── Device (Desktop Automation) ────────────────────────────────────────
  let deviceAdapter;
  if (useReal) {
    logger.info("Device: using PowerShell desktop adapter");
    deviceAdapter = new PowerShellDesktopHostAdapter();
  } else {
    logger.info("Device: using mock adapter");
    deviceAdapter = new MockDesktopHostAdapter();
  }
  const deviceWorker = createDesktopHostWorker({ adapter: deviceAdapter });

  // ─── Browser ────────────────────────────────────────────────────────────
  let browserAdapter;
  if (useReal && config.chrome) {
    logger.info(`Browser: using Chrome adapter (${config.chrome.debugging_url})`);
    browserAdapter = new ChromeAdapter({ debugging_url: config.chrome.debugging_url });
    auditCredentialAccess("browser", "chrome");
  } else {
    logger.info("Browser: using mock adapter");
    browserAdapter = new MockBrowserAdapter();
  }
  const browserWorker = createBrowserWorker({ adapter: browserAdapter });

  // ─── Social Media ──────────────────────────────────────────────────────
  let socialAdapter;
  if (useReal && config.chrome) {
    logger.info("Social: using browser social adapter (5 platforms)");
    socialAdapter = new BrowserSocialAdapter(browserAdapter);
  } else {
    logger.info("Social: using mock adapter");
    socialAdapter = new MockSocialAdapter();
  }
  const socialWorker = createSocialWorker({ adapter: socialAdapter });

  // ─── System Monitor ─────────────────────────────────────────────────────
  const systemAdapter = useReal ? new NodeSystemAdapter() : new MockSystemAdapter();
  const systemWorker = createSystemWorker({ adapter: systemAdapter });
  logger.info(`System: using ${useReal ? "Node.js" : "mock"} adapter`);

  // ─── Worker map ─────────────────────────────────────────────────────────
  const workers = new Map<string, WorkerExecuteFn>();
  workers.set("inference", inferenceWorker.execute);
  workers.set("email", emailWorker.execute);
  workers.set("document", documentWorker.execute);
  workers.set("crm", crmWorker.execute);
  workers.set("web", webWorker.execute);
  workers.set("calendar", calendarWorker.execute);
  workers.set("device", deviceWorker.execute);
  workers.set("browser", browserWorker.execute);
  workers.set("social", socialWorker.execute);
  workers.set("system", systemWorker.execute);

  // ─── Office ──────────────────────────────────────────────────────────────
  const officeAdapter = useReal ? new RealOfficeAdapter() : new MockOfficeAdapter();
  const officeWorker = createOfficeWorker({ adapter: officeAdapter });
  workers.set("office", officeWorker.execute);
  logger.info(`Office: using ${useReal ? "real (xlsx + docxtemplater + pptxgenjs)" : "mock"} adapter`);

  // ─── Interpreter ────────────────────────────────────────────────────────
  const interpreterAdapter = useReal ? new RealInterpreterAdapter({ chat: chatFn }) : new MockInterpreterAdapter();
  const interpreterWorker = createInterpreterWorker({ adapter: interpreterAdapter });
  workers.set("interpreter", interpreterWorker.execute);
  logger.info(`Interpreter: using ${useReal ? "real (child_process)" : "mock"} adapter`);

  // ─── Voice ──────────────────────────────────────────────────────────────
  const voiceAdapter = useReal ? new RealVoiceAdapter() : new MockVoiceAdapter();
  const voiceWorker = createVoiceWorker({ adapter: voiceAdapter });
  workers.set("voice", voiceWorker.execute);
  logger.info(`Voice: using ${useReal ? "real (ffmpeg/sox + whisper + piper/sapi)" : "mock"} adapter`);

  // ─── Security ──────────────────────────────────────────────────────────
  const securityAdapter = useReal ? new RealSecurityAdapter() : new MockSecurityAdapter();
  const securityWorker = createSecurityWorker({ adapter: securityAdapter });
  workers.set("security", securityWorker.execute);
  logger.info(`Security: using ${useReal ? "real (PowerShell + netsh)" : "mock"} adapter`);

  // ─── Time Tracking ──────────────────────────────────────────────────────
  let timeAdapter;
  if (useReal && config.toggl) {
    logger.info("Time: using Toggl adapter");
    timeAdapter = new TogglAdapter(config.toggl);
    auditCredentialAccess("time", "toggl");
  } else {
    logger.info("Time: using mock adapter");
    timeAdapter = new MockTimeAdapter();
  }
  const timeWorker = createTimeWorker({ adapter: timeAdapter });
  workers.set("time", timeWorker.execute);

  // ─── Google Drive ──────────────────────────────────────────────────────
  let driveAdapter;
  if (useReal && config.drive) {
    logger.info("Drive: using Google Drive adapter");
    driveAdapter = new GoogleDriveAdapter(config.drive);
    auditCredentialAccess("drive", "drive");
  } else {
    logger.info("Drive: using mock adapter");
    driveAdapter = new MockDriveAdapter();
  }
  const driveWorker = createDriveWorker({ adapter: driveAdapter });
  workers.set("drive", driveWorker.execute);

  // ─── Files ──────────────────────────────────────────────────────────────
  const fsPolicy = loadFilesystemPolicy(config);
  const filesWorker = createFilesWorkerBridge(fsPolicy);
  workers.set("files", filesWorker.execute);
  logger.info("Files: using Node.js fs bridge (policy-enforced)");

  logger.info(`Worker registry: ${workers.size} workers registered`);

  return {
    async executeJob(envelope: JobEnvelope): Promise<JobResult> {
      const prefix = envelope.type.split(".")[0];
      const worker = workers.get(prefix);
      const failedResult = (code: string, message: string): JobResult => ({
        contract_version: "jarvis.v1",
        job_id: envelope.job_id,
        job_type: envelope.type,
        status: "failed",
        summary: message,
        attempt: envelope.attempt,
        error: { code, message, retryable: false },
      });

      if (!worker) {
        logger.warn(`No worker for job type: ${envelope.type}`);
        return failedResult("UNKNOWN_JOB_TYPE", `No worker registered for prefix "${prefix}"`);
      }

      // ── Approval guard ──
      // Defense-in-depth: reject jobs that require approval but haven't been approved.
      // The orchestrator is the primary approval enforcer, but this catches edge cases.
      const policy = getExecutionPolicy(prefix!);
      if (policy?.requires_approval_guard) {
        const { JOB_APPROVAL_REQUIREMENT } = await import("@jarvis/shared");
        const requirement = JOB_APPROVAL_REQUIREMENT[envelope.type];
        if (requirement === "required" && envelope.approval_state !== "approved") {
          logger.warn(`Approval guard: blocked ${envelope.type} (state: ${envelope.approval_state})`);
          return failedResult("APPROVAL_REQUIRED", `Action "${envelope.type}" requires approval but approval_state is "${envelope.approval_state}"`);
        }
      }

      // ── Execute with error boundary + hard timeout ──
      // Priority: execution-policy timeout > job catalog timeout (on envelope) > 60s fallback
      const timeoutMs = (policy?.timeout_seconds ?? envelope.timeout_seconds ?? 60) * 1000;
      const startTime = Date.now();

      logger.debug(`Executing ${envelope.type}`, { job_id: envelope.job_id, timeout_ms: timeoutMs });

      try {
        const timeoutPromise = new Promise<JobResult>((_, reject) => {
          setTimeout(() => reject(new Error(`EXECUTION_TIMEOUT after ${timeoutMs}ms`)), timeoutMs);
        });

        const result = await Promise.race([worker(envelope), timeoutPromise]);
        const durationMs = Date.now() - startTime;

        // Record health
        healthMonitor?.recordExecution(prefix!, durationMs, result.status === "completed");

        logger.debug(`Result: ${result.status}`, { job_id: envelope.job_id, duration_ms: durationMs, summary: result.summary.slice(0, 100) });
        return result;
      } catch (e) {
        const durationMs = Date.now() - startTime;
        const errMsg = e instanceof Error ? e.message : String(e);
        const isTimeout = errMsg.includes("EXECUTION_TIMEOUT");

        if (isTimeout) {
          healthMonitor?.recordTimeout(prefix!);
          logger.warn(`Execution timeout: ${envelope.type} after ${timeoutMs}ms`, { job_id: envelope.job_id });
          return failedResult("EXECUTION_TIMEOUT", `${envelope.type} timed out after ${Math.round(timeoutMs / 1000)}s`);
        }

        // Error boundary: catch worker crashes without killing the daemon
        healthMonitor?.recordExecution(prefix!, durationMs, false);
        logger.error(`Worker crash: ${envelope.type}: ${errMsg}`, { job_id: envelope.job_id });
        return failedResult("WORKER_CRASH", errMsg);
      }
    },

    async chat(userPrompt: string, systemPrompt?: string): Promise<string> {
      return chatFn(userPrompt, systemPrompt);
    },

    getHealthMonitor(): WorkerHealthMonitor | undefined {
      return healthMonitor;
    },
  };
}

/** Build a minimal valid JobEnvelope for a given job type */
export function buildEnvelope(type: string, input: Record<string, unknown>): JobEnvelope {
  return {
    contract_version: "jarvis.v1",
    job_id: randomUUID(),
    type: type as JarvisJobType,
    session_key: `daemon-${Date.now()}`,
    requested_by: { source: "agent", agent_id: "daemon" },
    priority: "normal",
    approval_state: "not_required",
    timeout_seconds: JOB_TIMEOUT_SECONDS[type as JarvisJobType] ?? 120,
    attempt: 1,
    input,
    artifacts_in: [],
    metadata: {
      agent_id: "daemon",
      thread_key: null,
    },
  };
}
