import type { ArtifactRecord, JarvisApprovalState, LogEntry } from "@jarvis/shared";

export type DesktopWindowBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DesktopWindowRef = {
  window_id: string;
  title: string;
  app_id?: string;
  process_id?: number;
  is_focused: boolean;
  is_minimized?: boolean;
  bounds?: DesktopWindowBounds;
};

export type DesktopDisplayRef = {
  display_id: string;
  width: number;
  height: number;
  scale_factor?: number;
  is_primary: boolean;
};

export type DeviceSnapshotInput = {
  include?: {
    windows?: boolean;
    displays?: boolean;
    clipboard?: boolean;
    active_window?: boolean;
  };
  capture_screenshot?: boolean;
  output_name?: string;
};

export type DeviceSnapshotOutput = {
  host: {
    platform: string;
    hostname: string;
    user?: string;
  };
  observed_at: string;
  active_window?: DesktopWindowRef;
  windows?: DesktopWindowRef[];
  displays?: DesktopDisplayRef[];
  clipboard?: {
    has_text: boolean;
    text_preview?: string;
  };
  screenshot_artifact_id?: string;
};

export type DeviceListWindowsInput = {
  include_minimized?: boolean;
  title_contains?: string;
  app_id?: string;
};

export type DeviceListWindowsOutput = {
  window_count: number;
  windows: DesktopWindowRef[];
};

export type DeviceOpenAppInput = {
  app: {
    app_id?: string;
    executable?: string;
    display_name?: string;
  };
  arguments?: string[];
  wait_for_window?: boolean;
};

export type DeviceOpenAppOutput = {
  launched: boolean;
  app_id?: string;
  process_id?: number;
  window?: DesktopWindowRef;
};

export type DeviceFocusWindowInput = {
  window_id?: string;
  title_contains?: string;
  app_id?: string;
  strict_match?: boolean;
};

export type DeviceFocusWindowOutput = {
  focused: boolean;
  window: DesktopWindowRef;
};

export type DeviceCaptureTarget = "desktop" | "active_window" | "window" | "display" | "region";

export type DeviceCaptureRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DeviceScreenshotInput = {
  target: DeviceCaptureTarget;
  window_id?: string;
  display_id?: string;
  region?: DeviceCaptureRegion;
  format: "png" | "jpeg";
  output_name: string;
};

export type DeviceScreenshotOutput = {
  capture_artifact_id: string;
  target: DeviceCaptureTarget;
  format: string;
  width: number;
  height: number;
};

export type DeviceClickInput = {
  x: number;
  y: number;
  coordinate_space?: "screen" | "window";
  window_id?: string;
  button?: "left" | "right" | "middle";
  click_count?: number;
};

export type DeviceClickOutput = {
  performed: boolean;
  button: string;
  click_count: number;
  window_id?: string;
};

export type DeviceTypeTextInput = {
  text: string;
  mode?: "insert" | "replace" | "paste";
  submit?: boolean;
  window_id?: string;
};

export type DeviceTypeTextOutput = {
  typed_characters: number;
  mode: string;
  submitted: boolean;
  window_id?: string;
};

export type DeviceHotkeyInput = {
  keys: string[];
  window_id?: string;
};

export type DeviceHotkeyOutput = {
  sent: boolean;
  normalized_keys: string[];
  window_id?: string;
};

export type DeviceClipboardGetInput = {
  format?: "text" | "html" | "files" | "image";
};

export type DeviceClipboardGetOutput = {
  format: string;
  has_value: boolean;
  text?: string;
  files?: string[];
  artifact_id?: string;
};

export type DeviceClipboardSetInput = {
  text?: string;
  files?: Array<{
    artifact_id: string;
    name?: string;
    kind?: string;
    path?: string;
    path_context?: string;
    path_style?: string;
    checksum_sha256?: string;
    size_bytes?: number;
  }>;
  mode: "replace";
};

export type DeviceClipboardSetOutput = {
  applied: boolean;
  format: string;
  item_count: number;
};

export type DeviceNotifyInput = {
  title: string;
  body: string;
  urgency?: "low" | "normal" | "high";
};

export type DeviceNotifyOutput = {
  delivered: boolean;
  notification_id?: string;
};

export type DeviceAudioGetInput = Record<string, never>;

export type DeviceAudioGetOutput = {
  volume: number;
  muted: boolean;
  default_device?: {
    device_id: string;
    name: string;
    is_default: boolean;
    kind?: "playback" | "recording";
  };
  devices?: Array<{
    device_id: string;
    name: string;
    is_default: boolean;
    kind?: "playback" | "recording";
  }>;
};

export type DeviceAudioSetInput = {
  volume?: number;
  mute?: boolean;
  device?: string;
};

export type DeviceAudioSetOutput = {
  applied: boolean;
  volume: number;
  muted: boolean;
  device?: string;
};

export type DeviceDisplayGetInput = Record<string, never>;

export type DeviceDisplayGetOutput = {
  display_count: number;
  displays: Array<{
    display_id: string;
    name?: string;
    width: number;
    height: number;
    refresh_rate_hz?: number;
    brightness_percent?: number;
    scale_factor?: number;
    is_primary: boolean;
  }>;
};

export type DeviceDisplaySetInput = {
  display_id?: string;
  brightness?: number;
  resolution?: { width: number; height: number };
};

export type DeviceDisplaySetOutput = {
  applied: boolean;
  display_id?: string;
  brightness?: number;
  resolution?: { width: number; height: number };
};

export type DevicePowerActionInput = {
  action: "sleep" | "hibernate" | "shutdown" | "restart" | "lock";
};

export type DevicePowerActionOutput = {
  initiated: boolean;
  action: "sleep" | "hibernate" | "shutdown" | "restart" | "lock";
};

export type DeviceNetworkStatusInput = {
  interface_name?: string;
};

export type DeviceNetworkStatusOutput = {
  interfaces: Array<{
    interface_name: string;
    description?: string;
    status: "up" | "down" | "unknown";
    ip_address?: string;
    mac_address?: string;
    ssid?: string;
    signal_strength_dbm?: number;
    is_wifi?: boolean;
    is_vpn?: boolean;
  }>;
  internet_reachable?: boolean;
};

export type DeviceNetworkControlInput = {
  action: "connect" | "disconnect";
  ssid?: string;
  vpn_name?: string;
};

export type DeviceNetworkControlOutput = {
  applied: boolean;
  action: string;
  interface_name?: string;
  ssid?: string;
  vpn_name?: string;
};

export type DeviceWindowLayoutInput = {
  layout: "snap_left" | "snap_right" | "maximize" | "minimize" | "restore" | "tile_grid";
  window_ids?: string[];
};

export type DeviceWindowLayoutOutput = {
  applied: boolean;
  layout: string;
  affected_count: number;
  windows?: DesktopWindowRef[];
};

export type DeviceVirtualDesktopListInput = Record<string, never>;

export type DeviceVirtualDesktopListOutput = {
  desktop_count: number;
  desktops: Array<{
    desktop_id: string;
    name?: string;
    index?: number;
    is_current: boolean;
    window_count?: number;
  }>;
};

export type DeviceVirtualDesktopSwitchInput = {
  desktop_id?: string;
  direction?: "next" | "previous";
};

export type DeviceVirtualDesktopSwitchOutput = {
  switched: boolean;
  desktop?: {
    desktop_id: string;
    name?: string;
    index?: number;
    is_current: boolean;
    window_count?: number;
  };
};

export type DeviceFocusModeInput = {
  enabled: boolean;
  blocked_apps?: string[];
  mute_notifications?: boolean;
  duration_minutes?: number;
};

export type DeviceFocusModeOutput = {
  enabled: boolean;
  active: boolean;
  blocked_apps?: string[];
  muted_notifications?: boolean;
  ends_at?: string;
};

export type DeviceAppUsageInput = {
  since_hours?: number;
  top_n?: number;
  app_filter?: string;
};

export type DeviceAppUsageOutput = {
  apps: Array<{
    app_id: string;
    display_name: string;
    duration_seconds: number;
    window_count?: number;
  }>;
  total_tracked_seconds: number;
  since: string;
};

export type DesktopHostExecutionContext = {
  job_id: string;
  attempt: number;
  session_key: string;
  requested_by_channel: string;
  requested_by_user_id: string;
  timeout_seconds: number;
  approval_state: JarvisApprovalState;
  metadata: Record<string, unknown>;
};

export type ExecutionOutcome<TStructured extends Record<string, unknown>> = {
  summary: string;
  structured_output: TStructured;
  artifacts?: ArtifactRecord[];
  logs?: LogEntry[];
};

export class DesktopHostError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    retryable = false,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DesktopHostError";
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

export interface DesktopHostAdapter {
  snapshot(
    input: DeviceSnapshotInput,
    context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceSnapshotOutput>>;
  listWindows(
    input: DeviceListWindowsInput,
    context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceListWindowsOutput>>;
  openApp(
    input: DeviceOpenAppInput,
    context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceOpenAppOutput>>;
  focusWindow(
    input: DeviceFocusWindowInput,
    context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceFocusWindowOutput>>;
  screenshot(
    input: DeviceScreenshotInput,
    context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceScreenshotOutput>>;
  click(
    input: DeviceClickInput,
    context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceClickOutput>>;
  typeText(
    input: DeviceTypeTextInput,
    context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceTypeTextOutput>>;
  hotkey(
    input: DeviceHotkeyInput,
    context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceHotkeyOutput>>;
  clipboardGet(
    input: DeviceClipboardGetInput,
    context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceClipboardGetOutput>>;
  clipboardSet(
    input: DeviceClipboardSetInput,
    context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceClipboardSetOutput>>;
  notify(
    input: DeviceNotifyInput,
    context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceNotifyOutput>>;
  audioGet(
    input: DeviceAudioGetInput,
    context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceAudioGetOutput>>;
  audioSet(
    input: DeviceAudioSetInput,
    context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceAudioSetOutput>>;
  displayGet(
    input: DeviceDisplayGetInput,
    context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceDisplayGetOutput>>;
  displaySet(
    input: DeviceDisplaySetInput,
    context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceDisplaySetOutput>>;
  powerAction(
    input: DevicePowerActionInput,
    context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DevicePowerActionOutput>>;
  networkStatus(
    input: DeviceNetworkStatusInput,
    context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceNetworkStatusOutput>>;
  networkControl(
    input: DeviceNetworkControlInput,
    context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceNetworkControlOutput>>;
  windowLayout(
    input: DeviceWindowLayoutInput,
    context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceWindowLayoutOutput>>;
  virtualDesktopList(
    input: DeviceVirtualDesktopListInput,
    context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceVirtualDesktopListOutput>>;
  virtualDesktopSwitch(
    input: DeviceVirtualDesktopSwitchInput,
    context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceVirtualDesktopSwitchOutput>>;
  focusMode(
    input: DeviceFocusModeInput,
    context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceFocusModeOutput>>;
  appUsage(
    input: DeviceAppUsageInput,
    context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceAppUsageOutput>>;
}
