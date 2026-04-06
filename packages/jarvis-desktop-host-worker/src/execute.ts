import {
  CONTRACT_VERSION,
  JOB_APPROVAL_REQUIREMENT,
  type JobEnvelope,
  type JobError,
  type JobResult,
  type JarvisJobStatus,
  type JarvisJobType,
  type Metrics,
  type WorkerCallback
} from "@jarvis/shared";
import type {
  DesktopHostAdapter,
  DesktopHostExecutionContext,
  DeviceAppUsageInput,
  DeviceAudioGetInput,
  DeviceAudioSetInput,
  DeviceClickInput,
  DeviceClipboardGetInput,
  DeviceClipboardSetInput,
  DeviceDisplayGetInput,
  DeviceDisplaySetInput,
  DeviceFocusModeInput,
  DeviceFocusWindowInput,
  DeviceHotkeyInput,
  DeviceListWindowsInput,
  DeviceNetworkControlInput,
  DeviceNetworkStatusInput,
  DeviceNotifyInput,
  DeviceOpenAppInput,
  DevicePowerActionInput,
  DeviceScreenshotInput,
  DeviceSnapshotInput,
  DeviceTypeTextInput,
  DeviceVirtualDesktopListInput,
  DeviceVirtualDesktopSwitchInput,
  DeviceWindowLayoutInput,
  ExecutionOutcome
} from "./adapter.js";
import { DesktopHostError } from "./adapter.js";

export const DESKTOP_HOST_WORKER_ID = "desktop-host-worker";

export const DEVICE_JOB_TYPES = [
  "device.snapshot",
  "device.list_windows",
  "device.open_app",
  "device.focus_window",
  "device.screenshot",
  "device.click",
  "device.type_text",
  "device.hotkey",
  "device.clipboard_get",
  "device.clipboard_set",
  "device.notify",
  "device.audio_get",
  "device.audio_set",
  "device.display_get",
  "device.display_set",
  "device.power_action",
  "device.network_status",
  "device.network_control",
  "device.window_layout",
  "device.virtual_desktop_list",
  "device.virtual_desktop_switch",
  "device.focus_mode",
  "device.app_usage"
] as const;

export type DeviceJobType = (typeof DEVICE_JOB_TYPES)[number];

export type ExecuteDeviceJobOptions = {
  workerId?: string;
  now?: () => Date;
};

export type DesktopHostWorker = {
  workerId: string;
  execute(envelope: JobEnvelope): Promise<JobResult>;
  toCallback(result: JobResult): WorkerCallback;
};

export function isDeviceJobType(jobType: string): jobType is DeviceJobType {
  return (DEVICE_JOB_TYPES as readonly string[]).includes(jobType);
}

export function createDesktopHostWorker(
  config: {
    adapter: DesktopHostAdapter;
    workerId?: string;
    now?: () => Date;
  },
): DesktopHostWorker {
  const workerId = config.workerId ?? DESKTOP_HOST_WORKER_ID;
  return {
    workerId,
    execute: async (envelope) =>
      executeDeviceJob(envelope, config.adapter, {
        workerId,
        now: config.now
      }),
    toCallback: (result) => toWorkerCallback(result, workerId)
  };
}

export async function executeDeviceJob(
  envelope: JobEnvelope,
  adapter: DesktopHostAdapter,
  options: ExecuteDeviceJobOptions = {},
): Promise<JobResult> {
  const workerId = options.workerId ?? DESKTOP_HOST_WORKER_ID;
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();

  if (!isDeviceJobType(envelope.type)) {
    return createFailureResult(
      envelope,
      "failed",
      {
        code: "INVALID_INPUT",
        message: `Desktop host worker cannot execute ${envelope.type}.`,
        retryable: false,
        details: {
          supported_job_types: [...DEVICE_JOB_TYPES]
        }
      },
      workerId,
      startedAt,
      now().toISOString(),
    );
  }

  if (
    JOB_APPROVAL_REQUIREMENT[envelope.type] === "required" &&
    envelope.approval_state !== "approved"
  ) {
    return createFailureResult(
      envelope,
      "awaiting_approval",
      {
        code: "APPROVAL_REQUIRED",
        message: `Approval required before running ${envelope.type}.`,
        retryable: false
      },
      workerId,
      startedAt,
      now().toISOString(),
    );
  }

  const context = buildExecutionContext(envelope);

  try {
    const outcome = await routeEnvelope(envelope, adapter, context);
    return {
      contract_version: CONTRACT_VERSION,
      job_id: envelope.job_id,
      job_type: envelope.type,
      status: "completed",
      summary: outcome.summary,
      attempt: envelope.attempt,
      artifacts: outcome.artifacts,
      structured_output: outcome.structured_output,
      logs: outcome.logs,
      metrics: createMetrics(envelope.attempt, workerId, startedAt, now().toISOString())
    };
  } catch (error) {
    const jobError = toJobError(error, envelope.type);
    const status: JarvisJobStatus =
      jobError.code === "APPROVAL_REQUIRED" ? "awaiting_approval" : "failed";
    return createFailureResult(
      envelope,
      status,
      jobError,
      workerId,
      startedAt,
      now().toISOString(),
    );
  }
}

export function toWorkerCallback(
  result: JobResult,
  workerId = DESKTOP_HOST_WORKER_ID,
): WorkerCallback {
  return {
    contract_version: result.contract_version,
    job_id: result.job_id,
    job_type: result.job_type,
    attempt: result.attempt,
    status: result.status,
    summary: result.summary,
    worker_id: workerId,
    approval_id: result.approval_id,
    artifacts: result.artifacts,
    structured_output: result.structured_output,
    error: result.error,
    logs: result.logs,
    metrics: {
      ...result.metrics,
      worker_id: workerId
    }
  };
}

function buildExecutionContext(envelope: JobEnvelope): DesktopHostExecutionContext {
  return {
    job_id: envelope.job_id,
    attempt: envelope.attempt,
    session_key: envelope.session_key,
    requested_by_channel: envelope.requested_by.channel,
    requested_by_user_id: envelope.requested_by.user_id,
    timeout_seconds: envelope.timeout_seconds,
    approval_state: envelope.approval_state,
    metadata: envelope.metadata
  };
}

async function routeEnvelope(
  envelope: JobEnvelope,
  adapter: DesktopHostAdapter,
  context: DesktopHostExecutionContext,
): Promise<ExecutionOutcome<Record<string, unknown>>> {
  try {
    switch (envelope.type) {
      case "device.snapshot":
        return adapter.snapshot(envelope.input as DeviceSnapshotInput, context);
      case "device.list_windows":
        return adapter.listWindows(envelope.input as DeviceListWindowsInput, context);
      case "device.open_app":
        return adapter.openApp(envelope.input as DeviceOpenAppInput, context);
      case "device.focus_window":
        return adapter.focusWindow(envelope.input as DeviceFocusWindowInput, context);
      case "device.screenshot":
        return adapter.screenshot(envelope.input as DeviceScreenshotInput, context);
      case "device.click":
        return adapter.click(envelope.input as DeviceClickInput, context);
      case "device.type_text":
        return adapter.typeText(envelope.input as DeviceTypeTextInput, context);
      case "device.hotkey":
        return adapter.hotkey(envelope.input as DeviceHotkeyInput, context);
      case "device.clipboard_get":
        return adapter.clipboardGet(envelope.input as DeviceClipboardGetInput, context);
      case "device.clipboard_set":
        return adapter.clipboardSet(envelope.input as DeviceClipboardSetInput, context);
      case "device.notify":
        return adapter.notify(envelope.input as DeviceNotifyInput, context);
      case "device.audio_get":
        return adapter.audioGet(envelope.input as DeviceAudioGetInput, context);
      case "device.audio_set":
        return adapter.audioSet(envelope.input as DeviceAudioSetInput, context);
      case "device.display_get":
        return adapter.displayGet(envelope.input as DeviceDisplayGetInput, context);
      case "device.display_set":
        return adapter.displaySet(envelope.input as DeviceDisplaySetInput, context);
      case "device.power_action":
        return adapter.powerAction(envelope.input as DevicePowerActionInput, context);
      case "device.network_status":
        return adapter.networkStatus(envelope.input as DeviceNetworkStatusInput, context);
      case "device.network_control":
        return adapter.networkControl(envelope.input as DeviceNetworkControlInput, context);
      case "device.window_layout":
        return adapter.windowLayout(envelope.input as DeviceWindowLayoutInput, context);
      case "device.virtual_desktop_list":
        return adapter.virtualDesktopList(envelope.input as DeviceVirtualDesktopListInput, context);
      case "device.virtual_desktop_switch":
        return adapter.virtualDesktopSwitch(envelope.input as DeviceVirtualDesktopSwitchInput, context);
      case "device.focus_mode":
        return adapter.focusMode(envelope.input as DeviceFocusModeInput, context);
      case "device.app_usage":
        return adapter.appUsage(envelope.input as DeviceAppUsageInput, context);
      default:
        throw new DesktopHostError(
          "INVALID_INPUT",
          `Unsupported device job type ${String(envelope.type)}.`,
        );
    }
  } catch (error) {
    if (error instanceof DesktopHostError) {
      throw error;
    }
    if (error instanceof TypeError) {
      throw new DesktopHostError(
        "INVALID_INPUT",
        `Input validation failed for ${envelope.type}: ${error.message}`,
        false
      );
    }
    throw error;
  }
}

function createFailureResult(
  envelope: JobEnvelope,
  status: JarvisJobStatus,
  error: JobError,
  workerId: string,
  startedAt: string,
  finishedAt: string,
): JobResult {
  return {
    contract_version: CONTRACT_VERSION,
    job_id: envelope.job_id,
    job_type: envelope.type,
    status,
    summary:
      status === "awaiting_approval"
        ? `Approval required before running ${envelope.type}.`
        : `Failed to run ${envelope.type}.`,
    attempt: envelope.attempt,
    error,
    metrics: createMetrics(envelope.attempt, workerId, startedAt, finishedAt)
  };
}

function createMetrics(
  attempt: number,
  workerId: string,
  startedAt: string,
  finishedAt: string,
): Metrics {
  return {
    started_at: startedAt,
    finished_at: finishedAt,
    attempt,
    worker_id: workerId
  };
}

function toJobError(error: unknown, jobType: JarvisJobType): JobError {
  if (error instanceof DesktopHostError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      details: error.details
    };
  }

  if (error instanceof Error) {
    return {
      code: "INTERNAL_ERROR",
      message: error.message || `Unexpected failure while running ${jobType}.`,
      retryable: false
    };
  }

  return {
    code: "INTERNAL_ERROR",
    message: `Unexpected failure while running ${jobType}.`,
    retryable: false
  };
}
