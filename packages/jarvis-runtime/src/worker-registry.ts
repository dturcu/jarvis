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
import { createBrowserBridge } from "@jarvis/browser/openclaw-bridge";
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
import {
  withJobSpan,
  recordJobMetrics,
  ProvenanceSigner,
  hashContent,
  type ProvenanceRecord,
  inferenceRuntimeTotal,
  browserBridgeTotal,
  taskflowRunsTotal,
  inferenceCostUsdTotal,
  inferenceLocalPercentage,
} from "@jarvis/observability";
import { InferenceGovernor } from "@jarvis/inference";
import {
  logCredentialAccess,
  type CredentialAuditConfig,
} from "@jarvis/security/credential-audit";

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

  // Credential audit: uses the structured audit module from @jarvis/security.
  // Logs every credential distribution with worker ID, credential keys, and context.
  // See docs/KNOWN-TRUST-GAPS.md for the gap this closes.
  const credentialAuditConfig: CredentialAuditConfig = {
    db: runtimeDb!,
    enabled: !!runtimeDb,
  };

  const auditCredentialAccess = (workerId: string, credentialKeys: string[], context?: { runId?: string; jobId?: string }) => {
    logCredentialAccess(credentialAuditConfig, {
      worker_id: workerId,
      credential_keys: credentialKeys,
      run_id: context?.runId,
      job_id: context?.jobId,
      granted: credentialKeys.length > 0,
      timestamp: new Date().toISOString(),
    });
  };

  // ─── Provenance signer ──────────────────────────────────────────────────
  // Uses JARVIS_SIGNING_KEY env var; falls back to a dev-only key in non-production.
  const signingKey = process.env.JARVIS_SIGNING_KEY ?? (config.mode === "production" ? undefined : "jarvis-dev-signing-key-not-for-production");
  const provenanceSigner = signingKey && signingKey.length >= 32 ? new ProvenanceSigner(signingKey) : undefined;
  if (provenanceSigner) {
    logger.info("Provenance: HMAC-SHA256 signing enabled");
  } else {
    logger.debug("Provenance: signing disabled (no valid signing key)");
  }

  // Store provenance records in runtime.db (best-effort)
  const storeProvenance = (record: ProvenanceRecord): void => {
    if (!runtimeDb) return;
    try {
      runtimeDb.prepare(
        `INSERT INTO provenance_traces (record_id, job_id, job_type, agent_id, run_id, input_hash, output_hash, trace_id, sequence, prev_signature, signature, signed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        record.record_id, record.job_id, record.job_type,
        record.agent_id ?? null, record.run_id ?? null,
        record.input_hash, record.output_hash,
        record.trace_id ?? null, record.sequence,
        record.prev_signature ?? null, record.signature, record.signed_at,
      );
    } catch { /* best-effort — provenance table may not exist */ }
  };

  // ─── Inference ──────────────────────────────────────────────────────────
  const inferenceAdapter = useReal
    ? new DefaultInferenceAdapter(runtimeDb, config.lmstudio_url, opts?.embeddingPipeline, opts?.hybridRetriever)
    : new MockInferenceAdapter();
  const inferenceWorker = createInferenceWorker({ adapter: inferenceAdapter });

  // Inference governance — checks budget/latency/local-% before each inference job
  const inferenceGovernor = new InferenceGovernor();

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
    auditCredentialAccess("email", ["gmail"]);
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
    auditCredentialAccess("calendar", ["calendar"]);
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
    auditCredentialAccess("browser", ["chrome"]);
  } else {
    logger.info("Browser: using mock adapter");
    browserAdapter = new MockBrowserAdapter();
  }

  // Only create the BrowserBridge when openclaw mode is active.
  // In legacy mode, the worker uses the adapter directly — no bridge overhead.
  const browserMode = (process.env.JARVIS_BROWSER_MODE ?? "openclaw").toLowerCase();
  const browserBridge = browserMode === "openclaw"
    ? createBrowserBridge({ debuggingUrl: config.chrome?.debugging_url })
    : undefined;
  logger.info(`Browser bridge: ${browserMode} mode`);

  const browserWorker = createBrowserWorker({
    adapter: browserAdapter,
    bridge: browserBridge,
  });

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
    auditCredentialAccess("time", ["toggl"]);
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
    auditCredentialAccess("drive", ["drive"]);
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
        // ── Graceful fallback for planner-invented action types ──
        // The planner sometimes generates action subtypes that don't exist as registered workers.
        // Route them to the nearest capable worker rather than failing hard.
        const inferenceWorkerFn = workers.get("inference");
        const documentWorkerFn = workers.get("document");

        if (prefix === "inference" && inferenceWorkerFn) {
          // Unknown inference.* subtype — route as inference.chat with the action name in the prompt
          logger.warn(`Unknown inference subtype "${envelope.type}" — routing to inference.chat`);
          const rawInput = typeof envelope.input === "object" && envelope.input !== null
            ? envelope.input as Record<string, unknown>
            : {};
          const existingMessages = Array.isArray(rawInput.messages) ? rawInput.messages : [];
          const fallbackMessages = existingMessages.length > 0
            ? existingMessages
            : [{ role: "user", content: `Perform action "${envelope.type}": ${JSON.stringify(envelope.input ?? {})}` }];
          const chatEnvelope = {
            ...envelope,
            type: "inference.chat" as const,
            input: {
              ...rawInput,
              messages: fallbackMessages,
            },
          };
          return inferenceWorkerFn(chatEnvelope as JobEnvelope);
        }

        if (prefix === "document" && documentWorkerFn) {
          // Unknown document.* subtype — route as document.analyze_compliance
          logger.warn(`Unknown document subtype "${envelope.type}" — routing to document.analyze_compliance`);
          const fallbackEnvelope = { ...envelope, type: "document.analyze_compliance" as const };
          return documentWorkerFn(fallbackEnvelope as JobEnvelope);
        }

        if (inferenceWorkerFn && ["validation", "contracts", "clause_analysis", "recommendation", "negotiation_priorities", "file"].includes(prefix!)) {
          // Planner-invented prefixes with no registered worker — route as inference.chat
          logger.warn(`No worker for "${prefix}" — routing "${envelope.type}" to inference.chat`);
          const chatEnvelope = {
            ...envelope,
            type: "inference.chat" as const,
            input: {
              messages: [{ role: "user", content: `Perform action "${envelope.type}": ${JSON.stringify(envelope.input ?? {})}` }],
            },
          };
          return inferenceWorkerFn(chatEnvelope as JobEnvelope);
        }

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

      // ── Execute with error boundary + hard timeout + observability ──
      // Priority: execution-policy timeout > job catalog timeout (on envelope) > 60s fallback
      const timeoutMs = (policy?.timeout_seconds ?? envelope.timeout_seconds ?? 60) * 1000;
      const startTime = Date.now();

      logger.debug(`Executing ${envelope.type}`, { job_id: envelope.job_id, timeout_ms: timeoutMs });

      // Audit credential access at the actual job dispatch boundary,
      // where we have job_id and run context. Workers that use external
      // credentials are logged here (not at adapter construction time).
      const CRED_WORKERS: Record<string, string[]> = {
        email: ["gmail"], calendar: ["calendar"], browser: ["chrome"],
        social: ["chrome"], time: ["toggl"], drive: ["drive"],
      };
      const credKeys = CRED_WORKERS[prefix!];
      if (credKeys) {
        auditCredentialAccess(prefix!, credKeys, {
          jobId: envelope.job_id,
          runId: (envelope as Record<string, unknown>).run_id as string | undefined,
        });
      }

      try {
        const result = await withJobSpan(
          envelope.type,
          envelope.job_id,
          { "jarvis.worker": prefix!, "jarvis.priority": envelope.priority },
          async () => {
            const timeoutPromise = new Promise<JobResult>((_, reject) => {
              setTimeout(() => reject(new Error(`EXECUTION_TIMEOUT after ${timeoutMs}ms`)), timeoutMs);
            });
            return Promise.race([worker(envelope), timeoutPromise]);
          },
        );

        const durationMs = Date.now() - startTime;

        // Record health + metrics
        healthMonitor?.recordExecution(prefix!, durationMs, result.status === "completed");
        recordJobMetrics(envelope.type, result.status, durationMs, prefix!);

        // Convergence adoption metrics — track which runtime paths are in use
        if (prefix === "inference") {
          const runtime = "lmstudio"; // TODO: detect from actual model selection
          inferenceRuntimeTotal.labels(runtime).inc();

          // Record governance usage after successful inference
          const tokensUsed = typeof (result.structured_output as Record<string, unknown>)?.usage_tokens === "number"
            ? (result.structured_output as Record<string, unknown>).usage_tokens as number
            : 0;
          const estimatedCost = inferenceGovernor.estimateCost(
            String((result.structured_output as Record<string, unknown>)?.model ?? "unknown"),
            tokensUsed,
          );
          inferenceGovernor.recordUsage({
            timestamp: new Date().toISOString(),
            model: String((result.structured_output as Record<string, unknown>)?.model ?? "unknown"),
            runtime,
            tokens_used: tokensUsed,
            latency_ms: durationMs,
            estimated_cost_usd: estimatedCost,
          });
          inferenceCostUsdTotal.labels(runtime, String((result.structured_output as Record<string, unknown>)?.model ?? "unknown")).inc(estimatedCost);
          inferenceLocalPercentage.set(inferenceGovernor.getState().local_percentage);
        }
        if (prefix === "browser") {
          const mode = process.env.JARVIS_BROWSER_MODE?.toLowerCase() ?? "openclaw";
          browserBridgeTotal.labels(mode).inc();
        }

        // Sign provenance for all completed jobs when a signer is configured
        if (provenanceSigner && result.status === "completed") {
          try {
            const inputHash = hashContent(JSON.stringify(envelope.input));
            const outputHash = hashContent(JSON.stringify(result.structured_output ?? result.summary));
            const record = provenanceSigner.sign({
              job_id: envelope.job_id,
              job_type: envelope.type,
              agent_id: envelope.metadata?.agent_id as string | undefined,
              run_id: envelope.metadata?.run_id as string | undefined,
              input_hash: inputHash,
              output_hash: outputHash,
              sequence: 0,
            });
            storeProvenance(record);
          } catch (e) {
            logger.debug(`Provenance signing failed for ${envelope.job_id}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }

        logger.debug(`Result: ${result.status}`, { job_id: envelope.job_id, duration_ms: durationMs, summary: result.summary.slice(0, 100) });
        return result;
      } catch (e) {
        const durationMs = Date.now() - startTime;
        const errMsg = e instanceof Error ? e.message : String(e);
        const isTimeout = errMsg.includes("EXECUTION_TIMEOUT");

        if (isTimeout) {
          healthMonitor?.recordTimeout(prefix!);
          recordJobMetrics(envelope.type, "failed", durationMs, prefix!);
          logger.warn(`Execution timeout: ${envelope.type} after ${timeoutMs}ms`, { job_id: envelope.job_id });
          return failedResult("EXECUTION_TIMEOUT", `${envelope.type} timed out after ${Math.round(timeoutMs / 1000)}s`);
        }

        // Error boundary: catch worker crashes without killing the daemon
        healthMonitor?.recordExecution(prefix!, durationMs, false);
        recordJobMetrics(envelope.type, "failed", durationMs, prefix!);
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
export function buildEnvelope(
  type: string,
  input: Record<string, unknown>,
  approvalState: JarvisApprovalState = "not_required",
): JobEnvelope {
  return {
    contract_version: "jarvis.v1",
    job_id: randomUUID(),
    type: type as JarvisJobType,
    session_key: `daemon-${Date.now()}`,
    requested_by: { source: "agent", agent_id: "daemon" },
    priority: "normal",
    approval_state: approvalState,
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
