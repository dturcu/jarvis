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
import { CRM_DB_PATH, type JarvisRuntimeConfig } from "./config.js";
import type { Logger } from "./logger.js";

type WorkerExecuteFn = (envelope: JobEnvelope) => Promise<JobResult>;

export type WorkerRegistry = {
  executeJob(envelope: JobEnvelope): Promise<JobResult>;
  /** Simple convenience: call inference.chat and return the text content */
  chat(userPrompt: string, systemPrompt?: string): Promise<string>;
};

export function createWorkerRegistry(config: JarvisRuntimeConfig, logger: Logger): WorkerRegistry {
  const useReal = config.adapter_mode === "real";

  // ─── Inference ──────────────────────────────────────────────────────────
  const inferenceAdapter = useReal ? new DefaultInferenceAdapter() : new MockInferenceAdapter();
  const inferenceWorker = createInferenceWorker({ adapter: inferenceAdapter });

  // Chat helper for adapters that need LLM access
  const chatFn = async (prompt: string, systemPrompt?: string, profile?: { objective: string }): Promise<string> => {
    const messages: Array<{ role: string; content: string }> = [];
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({ role: "user", content: prompt });
    const model = config.default_model === "auto" ? undefined : config.default_model;
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
  } else {
    logger.info("Drive: using mock adapter");
    driveAdapter = new MockDriveAdapter();
  }
  const driveWorker = createDriveWorker({ adapter: driveAdapter });
  workers.set("drive", driveWorker.execute);

  // ─── Files ──────────────────────────────────────────────────────────────
  const filesWorker = createFilesWorkerBridge();
  workers.set("files", filesWorker.execute);
  logger.info("Files: using Node.js fs bridge");

  logger.info(`Worker registry: ${workers.size} workers registered`);

  return {
    async executeJob(envelope: JobEnvelope): Promise<JobResult> {
      const prefix = envelope.type.split(".")[0];
      const worker = workers.get(prefix);
      if (!worker) {
        logger.warn(`No worker for job type: ${envelope.type}`);
        return {
          contract_version: "jarvis.v1",
          job_id: envelope.job_id,
          job_type: envelope.type,
          status: "failed",
          summary: `No worker registered for prefix "${prefix}"`,
          attempt: envelope.attempt,
          error: { code: "UNKNOWN_JOB_TYPE", message: `No worker for ${envelope.type}`, retryable: false },
        };
      }

      logger.debug(`Executing ${envelope.type}`, { job_id: envelope.job_id });
      const result = await worker(envelope);
      logger.debug(`Result: ${result.status}`, { job_id: envelope.job_id, summary: result.summary.slice(0, 100) });
      return result;
    },

    async chat(userPrompt: string, systemPrompt?: string): Promise<string> {
      return chatFn(userPrompt, systemPrompt);
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
