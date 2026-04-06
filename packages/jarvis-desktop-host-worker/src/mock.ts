import type { ArtifactRecord } from "@jarvis/shared";
import {
  DesktopHostError,
  type DesktopDisplayRef,
  type DesktopHostAdapter,
  type DesktopHostExecutionContext,
  type DesktopWindowRef,
  type DeviceAppUsageInput,
  type DeviceAppUsageOutput,
  type DeviceAudioGetInput,
  type DeviceAudioGetOutput,
  type DeviceAudioSetInput,
  type DeviceAudioSetOutput,
  type DeviceCaptureRegion,
  type DeviceClickInput,
  type DeviceClickOutput,
  type DeviceClipboardGetInput,
  type DeviceClipboardGetOutput,
  type DeviceClipboardSetInput,
  type DeviceClipboardSetOutput,
  type DeviceDisplayGetInput,
  type DeviceDisplayGetOutput,
  type DeviceDisplaySetInput,
  type DeviceDisplaySetOutput,
  type DeviceFocusModeInput,
  type DeviceFocusModeOutput,
  type DeviceFocusWindowInput,
  type DeviceFocusWindowOutput,
  type DeviceHotkeyInput,
  type DeviceHotkeyOutput,
  type DeviceListWindowsInput,
  type DeviceListWindowsOutput,
  type DeviceNetworkControlInput,
  type DeviceNetworkControlOutput,
  type DeviceNetworkStatusInput,
  type DeviceNetworkStatusOutput,
  type DeviceNotifyInput,
  type DeviceNotifyOutput,
  type DeviceOpenAppInput,
  type DeviceOpenAppOutput,
  type DevicePowerActionInput,
  type DevicePowerActionOutput,
  type DeviceScreenshotInput,
  type DeviceScreenshotOutput,
  type DeviceSnapshotInput,
  type DeviceSnapshotOutput,
  type DeviceTypeTextInput,
  type DeviceTypeTextOutput,
  type DeviceVirtualDesktopListInput,
  type DeviceVirtualDesktopListOutput,
  type DeviceVirtualDesktopSwitchInput,
  type DeviceVirtualDesktopSwitchOutput,
  type DeviceWindowLayoutInput,
  type DeviceWindowLayoutOutput,
  type ExecutionOutcome
} from "./adapter.js";

type MockClipboardState = {
  format: "text" | "html" | "files" | "image";
  text?: string;
  files?: string[];
  artifact?: ArtifactRecord;
};

type MockAudioState = {
  volume: number;
  muted: boolean;
  defaultDeviceId: string;
};

type MockVirtualDesktop = {
  desktop_id: string;
  name: string;
  index: number;
  is_current: boolean;
  window_count: number;
};

type MockDesktopHostOptions = {
  host?: {
    platform?: string;
    hostname?: string;
    user?: string;
  };
  windows?: DesktopWindowRef[];
  displays?: DesktopDisplayRef[];
  clipboard?: MockClipboardState;
  audio?: MockAudioState;
  artifactRoot?: string;
  processSeed?: number;
};

type InputActionRecord =
  | {
      kind: "click";
      x: number;
      y: number;
      button: string;
      click_count: number;
      window_id?: string;
    }
  | {
      kind: "type_text";
      text: string;
      mode: string;
      submitted: boolean;
      window_id?: string;
    }
  | {
      kind: "hotkey";
      normalized_keys: string[];
      window_id?: string;
    };

type NotificationRecord = {
  notification_id: string;
  title: string;
  body: string;
  urgency: string;
};

export class MockDesktopHostAdapter implements DesktopHostAdapter {
  private readonly host: {
    platform: string;
    hostname: string;
    user?: string;
  };

  private readonly artifactRoot: string;
  private readonly windows: DesktopWindowRef[];
  private readonly displays: DesktopDisplayRef[];
  private clipboard: MockClipboardState;
  private audio: MockAudioState;
  private virtualDesktops: MockVirtualDesktop[];
  private processId: number;
  private artifactId = 0;
  private notificationId = 0;
  private readonly inputActions: InputActionRecord[] = [];
  private readonly notifications: NotificationRecord[] = [];

  constructor(options: MockDesktopHostOptions = {}) {
    this.host = {
      platform: options.host?.platform ?? "windows",
      hostname: options.host?.hostname ?? "jarvis-workstation",
      user: options.host?.user ?? "operator"
    };
    this.artifactRoot = options.artifactRoot ?? "C:\\Jarvis\\artifacts";
    this.windows = options.windows?.map(cloneWindow) ?? [
      {
        window_id: "win-terminal",
        title: "Windows Terminal",
        app_id: "terminal",
        process_id: 5001,
        is_focused: true,
        bounds: {
          x: 120,
          y: 80,
          width: 1280,
          height: 720
        }
      },
      {
        window_id: "win-notes",
        title: "Project Notes",
        app_id: "notes",
        process_id: 5002,
        is_focused: false,
        bounds: {
          x: 180,
          y: 140,
          width: 960,
          height: 640
        }
      }
    ];
    this.displays = options.displays?.map(cloneDisplay) ?? [
      {
        display_id: "display-1",
        width: 1920,
        height: 1080,
        scale_factor: 1,
        is_primary: true
      }
    ];
    this.clipboard = options.clipboard ?? {
      format: "text",
      text: "Draft proposal for Acme"
    };
    this.audio = options.audio ?? {
      volume: 65,
      muted: false,
      defaultDeviceId: "speaker-realtek-01"
    };
    this.virtualDesktops = [
      { desktop_id: "vd-00000001", name: "Desktop 1", index: 0, is_current: true, window_count: 2 }
    ];
    this.processId = options.processSeed ?? 9000;
  }

  getWindows(): DesktopWindowRef[] {
    return this.windows.map(cloneWindow);
  }

  getNotifications(): NotificationRecord[] {
    return this.notifications.map((item) => ({ ...item }));
  }

  getInputActions(): InputActionRecord[] {
    return this.inputActions.map((item) => ({ ...item }));
  }

  getClipboard(): MockClipboardState {
    return {
      ...this.clipboard,
      files: this.clipboard.files ? [...this.clipboard.files] : undefined,
      artifact: this.clipboard.artifact ? { ...this.clipboard.artifact } : undefined
    };
  }

  async snapshot(
    input: DeviceSnapshotInput,
    context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceSnapshotOutput>> {
    const include = input.include ?? {};
    const artifacts: ArtifactRecord[] = [];
    let screenshotArtifact: ArtifactRecord | undefined;

    if (input.capture_screenshot) {
      screenshotArtifact = this.createArtifact(
        input.output_name ?? `snapshot-${context.job_id}.png`,
        "png",
      );
      artifacts.push(screenshotArtifact);
    }

    return {
      summary: "Captured the current device snapshot.",
      artifacts: artifacts.length ? artifacts : undefined,
      structured_output: {
        host: {
          ...this.host
        },
        observed_at: new Date().toISOString(),
        active_window: include.active_window === false ? undefined : this.getActiveWindow(),
        windows: include.windows === false ? undefined : this.getWindows(),
        displays: include.displays === false ? undefined : this.displays.map(cloneDisplay),
        clipboard:
          include.clipboard === true
            ? {
                has_text: Boolean(this.clipboard.text),
                text_preview: this.clipboard.text?.slice(0, 120)
              }
            : undefined,
        screenshot_artifact_id: screenshotArtifact?.artifact_id
      }
    };
  }

  async listWindows(
    input: DeviceListWindowsInput,
    _context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceListWindowsOutput>> {
    const windows = this.filterWindows(input);
    return {
      summary: `Listed ${windows.length} window(s).`,
      structured_output: {
        window_count: windows.length,
        windows
      }
    };
  }

  async openApp(
    input: DeviceOpenAppInput,
    _context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceOpenAppOutput>> {
    const appId =
      input.app.app_id ??
      normalizeAppId(input.app.executable) ??
      normalizeAppId(input.app.display_name);
    if (!appId) {
      throw new DesktopHostError("APP_NOT_FOUND", "No app identifier was provided.");
    }

    const processId = ++this.processId;
    const title = input.app.display_name ?? `${toTitleCase(appId)} Window`;
    this.setFocused(undefined);
    const window: DesktopWindowRef = {
      window_id: `win-${appId}-${processId}`,
      title,
      app_id: appId,
      process_id: processId,
      is_focused: true,
      bounds: {
        x: 220,
        y: 160,
        width: 1100,
        height: 760
      }
    };
    this.windows.unshift(window);
    return {
      summary: input.wait_for_window === false
        ? `Launched ${toTitleCase(appId)}.`
        : `Launched ${toTitleCase(appId)} and detected the new window.`,
      structured_output: {
        launched: true,
        app_id: appId,
        process_id: processId,
        window
      }
    };
  }

  async focusWindow(
    input: DeviceFocusWindowInput,
    _context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceFocusWindowOutput>> {
    const window = this.findWindow(input);
    if (!window) {
      throw new DesktopHostError("WINDOW_NOT_FOUND", "No matching window was found.");
    }
    this.setFocused(window.window_id);
    const focusedWindow = this.requireWindow(window.window_id);
    return {
      summary: `Focused ${focusedWindow.title}.`,
      structured_output: {
        focused: true,
        window: focusedWindow
      }
    };
  }

  async screenshot(
    input: DeviceScreenshotInput,
    _context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceScreenshotOutput>> {
    const size = this.resolveCaptureSize(input);
    const artifact = this.createArtifact(input.output_name, input.format);
    return {
      summary: `Captured the ${input.target} screenshot.`,
      artifacts: [artifact],
      structured_output: {
        capture_artifact_id: artifact.artifact_id,
        target: input.target,
        format: input.format,
        width: size.width,
        height: size.height
      }
    };
  }

  async click(
    input: DeviceClickInput,
    _context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceClickOutput>> {
    if (input.x < 0 || input.y < 0) {
      throw new DesktopHostError(
        "TARGET_OUT_OF_BOUNDS",
        "Pointer target is outside the visible coordinate space.",
      );
    }

    const windowId = input.window_id ?? this.getActiveWindow()?.window_id;
    if (input.coordinate_space === "window" && !windowId) {
      throw new DesktopHostError("WINDOW_NOT_FOUND", "No active window is available.");
    }

    this.inputActions.push({
      kind: "click",
      x: input.x,
      y: input.y,
      button: input.button ?? "left",
      click_count: input.click_count ?? 1,
      window_id: windowId
    });

    return {
      summary: `Clicked ${input.button ?? "left"} at ${input.x}, ${input.y}.`,
      structured_output: {
        performed: true,
        button: input.button ?? "left",
        click_count: input.click_count ?? 1,
        window_id: windowId
      }
    };
  }

  async typeText(
    input: DeviceTypeTextInput,
    _context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceTypeTextOutput>> {
    const windowId = input.window_id ?? this.getActiveWindow()?.window_id;
    if (input.window_id && !this.findWindow({ window_id: input.window_id })) {
      throw new DesktopHostError("WINDOW_NOT_FOUND", "No matching window was found.");
    }

    this.inputActions.push({
      kind: "type_text",
      text: input.text,
      mode: input.mode ?? "insert",
      submitted: input.submit ?? false,
      window_id: windowId
    });

    return {
      summary: `Typed ${input.text.length} characters.`,
      structured_output: {
        typed_characters: input.text.length,
        mode: input.mode ?? "insert",
        submitted: input.submit ?? false,
        window_id: windowId
      }
    };
  }

  async hotkey(
    input: DeviceHotkeyInput,
    _context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceHotkeyOutput>> {
    const normalizedKeys = uniquePreservingOrder(
      input.keys.map((item) => item.toLowerCase()),
    );
    const windowId = input.window_id ?? this.getActiveWindow()?.window_id;
    if (input.window_id && !this.findWindow({ window_id: input.window_id })) {
      throw new DesktopHostError("WINDOW_NOT_FOUND", "No matching window was found.");
    }

    this.inputActions.push({
      kind: "hotkey",
      normalized_keys: normalizedKeys,
      window_id: windowId
    });

    return {
      summary: `Sent hotkey ${normalizedKeys.join("+")}.`,
      structured_output: {
        sent: true,
        normalized_keys: normalizedKeys,
        window_id: windowId
      }
    };
  }

  async clipboardGet(
    input: DeviceClipboardGetInput,
    _context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceClipboardGetOutput>> {
    const requestedFormat = input.format ?? this.clipboard.format;
    if (requestedFormat === "text" || requestedFormat === "html") {
      const text = this.clipboard.format === requestedFormat ? this.clipboard.text : undefined;
      return {
        summary: `Read the clipboard as ${requestedFormat}.`,
        structured_output: {
          format: requestedFormat,
          has_value: Boolean(text),
          text
        }
      };
    }

    if (requestedFormat === "files") {
      const files = this.clipboard.format === "files" ? this.clipboard.files : undefined;
      return {
        summary: "Read the clipboard file list.",
        structured_output: {
          format: "files",
          has_value: Boolean(files?.length),
          files
        }
      };
    }

    const artifact = this.clipboard.format === "image" ? this.clipboard.artifact : undefined;
    return {
      summary: "Read the clipboard image.",
      artifacts: artifact ? [{ ...artifact }] : undefined,
      structured_output: {
        format: "image",
        has_value: Boolean(artifact),
        artifact_id: artifact?.artifact_id
      }
    };
  }

  async clipboardSet(
    input: DeviceClipboardSetInput,
    _context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceClipboardSetOutput>> {
    if (input.text !== undefined) {
      this.clipboard = {
        format: "text",
        text: input.text
      };
      return {
        summary: "Updated the clipboard text.",
        structured_output: {
          applied: true,
          format: "text",
          item_count: input.text ? 1 : 0
        }
      };
    }

    const files = input.files?.map((item) => item.artifact_id) ?? [];
    this.clipboard = {
      format: "files",
      files
    };
    return {
      summary: "Updated the clipboard file list.",
      structured_output: {
        applied: true,
        format: "files",
        item_count: files.length
      }
    };
  }

  async notify(
    input: DeviceNotifyInput,
    _context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceNotifyOutput>> {
    const notification_id = `notification-${++this.notificationId}`;
    this.notifications.push({
      notification_id,
      title: input.title,
      body: input.body,
      urgency: input.urgency ?? "normal"
    });
    return {
      summary: `Sent notification ${input.title}.`,
      structured_output: {
        delivered: true,
        notification_id
      }
    };
  }

  async audioGet(
    _input: DeviceAudioGetInput,
    _context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceAudioGetOutput>> {
    return {
      summary: `Retrieved current audio state: volume ${this.audio.volume}%, ${this.audio.muted ? "muted" : "unmuted"}.`,
      structured_output: {
        volume: this.audio.volume,
        muted: this.audio.muted,
        default_device: {
          device_id: this.audio.defaultDeviceId,
          name: "Default Playback Device",
          is_default: true,
          kind: "playback"
        },
        devices: [
          {
            device_id: this.audio.defaultDeviceId,
            name: "Default Playback Device",
            is_default: true,
            kind: "playback"
          }
        ]
      }
    };
  }

  async audioSet(
    input: DeviceAudioSetInput,
    _context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceAudioSetOutput>> {
    if (input.volume !== undefined) {
      if (input.volume < 0 || input.volume > 100) {
        throw new DesktopHostError("INVALID_INPUT", "Volume must be between 0 and 100.");
      }
      this.audio.volume = input.volume;
    }
    if (input.mute !== undefined) {
      this.audio.muted = input.mute;
    }
    if (input.device) {
      this.audio.defaultDeviceId = input.device;
    }

    const parts: string[] = [];
    if (input.volume !== undefined) {
      parts.push(`volume ${this.audio.volume}%`);
    }
    if (input.mute !== undefined) {
      parts.push(this.audio.muted ? "muted" : "unmuted");
    }

    return {
      summary: `Audio updated: ${parts.join(", ")}.`,
      structured_output: {
        applied: true,
        volume: this.audio.volume,
        muted: this.audio.muted,
        device: input.device
      }
    };
  }

  async displayGet(
    _input: DeviceDisplayGetInput,
    _context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceDisplayGetOutput>> {
    const displays = this.displays.map((d) => ({
      display_id: d.display_id,
      name: d.display_id,
      width: d.width,
      height: d.height,
      refresh_rate_hz: 60,
      brightness_percent: 75,
      scale_factor: d.scale_factor ?? 1,
      is_primary: d.is_primary
    }));

    return {
      summary: `Retrieved display configuration: ${displays.length} monitor(s) detected.`,
      structured_output: {
        display_count: displays.length,
        displays
      }
    };
  }

  async displaySet(
    input: DeviceDisplaySetInput,
    _context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceDisplaySetOutput>> {
    if (input.brightness === undefined && !input.resolution) {
      throw new DesktopHostError("INVALID_INPUT", "At least one of brightness or resolution must be provided.");
    }
    if (input.brightness !== undefined && (input.brightness < 0 || input.brightness > 100)) {
      throw new DesktopHostError("INVALID_INPUT", "Brightness must be between 0 and 100.");
    }

    const parts: string[] = [];
    if (input.brightness !== undefined) {
      parts.push(`brightness ${input.brightness}%`);
    }
    if (input.resolution) {
      parts.push(`resolution ${input.resolution.width}x${input.resolution.height}`);
    }

    return {
      summary: `Display updated: ${parts.join(", ")}${input.display_id ? ` on ${input.display_id}` : ""}.`,
      structured_output: {
        applied: true,
        display_id: input.display_id,
        brightness: input.brightness,
        resolution: input.resolution
      }
    };
  }

  async powerAction(
    input: DevicePowerActionInput,
    _context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DevicePowerActionOutput>> {
    const validActions = new Set(["sleep", "hibernate", "shutdown", "restart", "lock"]);
    if (!validActions.has(input.action)) {
      throw new DesktopHostError("INVALID_INPUT", `Unsupported power action: ${String(input.action)}.`);
    }

    return {
      summary: `Power action '${input.action}' initiated successfully.`,
      structured_output: {
        initiated: true,
        action: input.action
      }
    };
  }

  async networkStatus(
    _input: DeviceNetworkStatusInput,
    _context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceNetworkStatusOutput>> {
    return {
      summary: "Retrieved network status: 1 interface(s), internet reachable.",
      structured_output: {
        interfaces: [
          {
            interface_name: "Wi-Fi",
            description: "Mock WiFi Adapter",
            status: "up",
            ip_address: "192.168.1.100",
            is_wifi: true,
            is_vpn: false
          }
        ],
        internet_reachable: true
      }
    };
  }

  async networkControl(
    input: DeviceNetworkControlInput,
    _context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceNetworkControlOutput>> {
    if (input.action !== "connect" && input.action !== "disconnect") {
      throw new DesktopHostError("INVALID_INPUT", `Unsupported network action: ${String(input.action)}.`);
    }

    const target = input.ssid ?? input.vpn_name;
    const actionVerb = input.action === "connect" ? "Connected to" : "Disconnected from";

    return {
      summary: `${actionVerb} ${input.ssid ? `WiFi network '${input.ssid}'` : `VPN '${input.vpn_name}'`}.`,
      structured_output: {
        applied: true,
        action: input.action,
        interface_name: "Wi-Fi",
        ssid: input.ssid,
        vpn_name: input.vpn_name
      }
    };
    void target;
  }

  async windowLayout(
    input: DeviceWindowLayoutInput,
    _context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceWindowLayoutOutput>> {
    const validLayouts = new Set(["snap_left", "snap_right", "maximize", "minimize", "restore", "tile_grid"]);
    if (!validLayouts.has(input.layout)) {
      throw new DesktopHostError("INVALID_INPUT", `Unsupported layout: ${String(input.layout)}.`);
    }

    const targetWindows = input.window_ids?.length
      ? this.windows.filter((w) => input.window_ids!.includes(w.window_id)).map(cloneWindow)
      : this.getActiveWindow() ? [this.getActiveWindow()!] : [];

    return {
      summary: `Applied '${input.layout}' layout to ${targetWindows.length} window(s).`,
      structured_output: {
        applied: true,
        layout: input.layout,
        affected_count: targetWindows.length,
        windows: targetWindows.length ? targetWindows : undefined
      }
    };
  }

  async virtualDesktopList(
    _input: DeviceVirtualDesktopListInput,
    _context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceVirtualDesktopListOutput>> {
    return {
      summary: `Found ${this.virtualDesktops.length} virtual desktop(s).`,
      structured_output: {
        desktop_count: this.virtualDesktops.length,
        desktops: this.virtualDesktops.map((d) => ({ ...d }))
      }
    };
  }

  async virtualDesktopSwitch(
    input: DeviceVirtualDesktopSwitchInput,
    _context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceVirtualDesktopSwitchOutput>> {
    if (!input.desktop_id && !input.direction) {
      throw new DesktopHostError("INVALID_INPUT", "Either desktop_id or direction must be provided.");
    }

    const currentIdx = this.virtualDesktops.findIndex((d) => d.is_current);
    let targetIdx = currentIdx;

    if (input.direction === "next") {
      targetIdx = (currentIdx + 1) % this.virtualDesktops.length;
    } else if (input.direction === "previous") {
      targetIdx = (currentIdx - 1 + this.virtualDesktops.length) % this.virtualDesktops.length;
    } else if (input.desktop_id) {
      const idx = this.virtualDesktops.findIndex((d) => d.desktop_id === input.desktop_id);
      if (idx === -1) {
        throw new DesktopHostError("DESKTOP_NOT_FOUND", `Virtual desktop '${input.desktop_id}' not found.`);
      }
      targetIdx = idx;
    }

    for (let i = 0; i < this.virtualDesktops.length; i++) {
      this.virtualDesktops[i]!.is_current = i === targetIdx;
    }

    const target = this.virtualDesktops[targetIdx];
    return {
      summary: `Switched to virtual desktop${target?.name ? ` '${target.name}'` : ""}.`,
      structured_output: {
        switched: true,
        desktop: target ? { ...target } : undefined
      }
    };
  }

  async focusMode(
    input: DeviceFocusModeInput,
    _context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceFocusModeOutput>> {
    const endsAt = input.duration_minutes
      ? new Date(Date.now() + input.duration_minutes * 60 * 1000).toISOString()
      : undefined;

    if (input.enabled) {
      const parts: string[] = [];
      if (input.blocked_apps?.length) {
        parts.push(`${input.blocked_apps.length} app(s) blocked`);
      }
      if (input.mute_notifications) {
        parts.push("notifications muted");
      }
      if (input.duration_minutes) {
        parts.push(`for ${input.duration_minutes} minutes`);
      }
      const detail = parts.length ? `. ${parts.join(", ")}.` : ".";

      return {
        summary: `Focus mode enabled${detail}`,
        structured_output: {
          enabled: true,
          active: true,
          blocked_apps: input.blocked_apps,
          muted_notifications: input.mute_notifications,
          ends_at: endsAt
        }
      };
    }

    return {
      summary: "Focus mode disabled.",
      structured_output: {
        enabled: false,
        active: false
      }
    };
  }

  async appUsage(
    input: DeviceAppUsageInput,
    _context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceAppUsageOutput>> {
    const sinceHours = input.since_hours ?? 8;
    const topN = input.top_n ?? 10;
    const since = new Date(Date.now() - sinceHours * 3600 * 1000).toISOString();

    const mockApps: DeviceAppUsageOutput["apps"] = [
      { app_id: "vscode", display_name: "Visual Studio Code", duration_seconds: 14400, window_count: 3 },
      { app_id: "chrome", display_name: "Google Chrome", duration_seconds: 7200, window_count: 8 },
      { app_id: "terminal", display_name: "Windows Terminal", duration_seconds: 3600, window_count: 2 },
      { app_id: "slack", display_name: "Slack", duration_seconds: 1800, window_count: 1 },
      { app_id: "notes", display_name: "Notepad", duration_seconds: 600, window_count: 1 }
    ];

    let apps = mockApps;
    if (input.app_filter) {
      const filter = input.app_filter.toLowerCase();
      apps = apps.filter(
        (a) =>
          a.app_id.toLowerCase().includes(filter) ||
          a.display_name.toLowerCase().includes(filter),
      );
    }
    apps = apps.slice(0, topN);

    const totalTrackedSeconds = apps.reduce((sum, a) => sum + a.duration_seconds, 0);

    return {
      summary: `Retrieved app usage for the past ${sinceHours} hour(s). ${apps.length} app(s) returned.`,
      structured_output: {
        apps,
        total_tracked_seconds: totalTrackedSeconds,
        since
      }
    };
  }

  private filterWindows(input: DeviceListWindowsInput): DesktopWindowRef[] {
    const titleContains = input.title_contains?.toLowerCase();
    const appId = input.app_id?.toLowerCase();
    return this.windows
      .filter((window) => input.include_minimized || !window.is_minimized)
      .filter((window) =>
        titleContains ? window.title.toLowerCase().includes(titleContains) : true,
      )
      .filter((window) =>
        appId ? window.app_id?.toLowerCase() === appId : true,
      )
      .map(cloneWindow);
  }

  private findWindow(input: {
    window_id?: string;
    title_contains?: string;
    app_id?: string;
    strict_match?: boolean;
  }): DesktopWindowRef | undefined {
    const titleContains = input.title_contains?.toLowerCase();
    const appId = input.app_id?.toLowerCase();
    return this.windows.find((window) => {
      if (input.window_id && window.window_id !== input.window_id) {
        return false;
      }
      if (appId && window.app_id?.toLowerCase() !== appId) {
        return false;
      }
      if (titleContains) {
        const title = window.title.toLowerCase();
        return input.strict_match ? title === titleContains : title.includes(titleContains);
      }
      return true;
    });
  }

  private setFocused(windowId: string | undefined): void {
    for (const window of this.windows) {
      window.is_focused = Boolean(windowId && window.window_id === windowId);
    }
  }

  private getActiveWindow(): DesktopWindowRef | undefined {
    const window = this.windows.find((item) => item.is_focused) ?? this.windows[0];
    return window ? cloneWindow(window) : undefined;
  }

  private requireWindow(windowId: string): DesktopWindowRef {
    const window = this.windows.find((item) => item.window_id === windowId);
    if (!window) {
      throw new DesktopHostError("WINDOW_NOT_FOUND", "No matching window was found.");
    }
    return cloneWindow(window);
  }

  private resolveCaptureSize(input: DeviceScreenshotInput): {
    width: number;
    height: number;
  } {
    switch (input.target) {
      case "desktop": {
        const primary = this.displays.find((item) => item.is_primary) ?? this.displays[0];
        if (!primary) {
          throw new DesktopHostError("CAPTURE_FAILED", "No display is available.");
        }
        return {
          width: primary.width,
          height: primary.height
        };
      }
      case "display": {
        const display = this.displays.find((item) => item.display_id === input.display_id);
        if (!display) {
          throw new DesktopHostError("CAPTURE_FAILED", "The requested display was not found.");
        }
        return {
          width: display.width,
          height: display.height
        };
      }
      case "window":
      case "active_window": {
        const window =
          input.target === "window"
            ? this.findWindow({ window_id: input.window_id })
            : this.getActiveWindow();
        if (!window) {
          throw new DesktopHostError("WINDOW_NOT_FOUND", "No matching window was found.");
        }
        return regionSize(window.bounds);
      }
      case "region":
        return regionSize(input.region);
      default:
        throw new DesktopHostError("CAPTURE_FAILED", "Unsupported screenshot target.");
    }
  }

  private createArtifact(name: string, kind: string): ArtifactRecord {
    const artifact_id = `artifact-${++this.artifactId}`;
    return {
      artifact_id,
      kind,
      name,
      path: `${this.artifactRoot}\\${name}`,
      path_context: "windows-host",
      path_style: "windows",
      size_bytes: 131072
    };
  }
}

function cloneWindow(window: DesktopWindowRef): DesktopWindowRef {
  return {
    ...window,
    bounds: window.bounds ? { ...window.bounds } : undefined
  };
}

function cloneDisplay(display: DesktopDisplayRef): DesktopDisplayRef {
  return {
    ...display
  };
}

function uniquePreservingOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

function normalizeAppId(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return value
    .replaceAll("\\", "/")
    .split("/")
    .at(-1)
    ?.replace(/\.[a-z0-9]+$/i, "")
    .trim()
    .toLowerCase();
}

function toTitleCase(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(" ");
}

function regionSize(region: DeviceCaptureRegion | DesktopWindowRef["bounds"] | undefined): {
  width: number;
  height: number;
} {
  if (!region) {
    return {
      width: 1280,
      height: 720
    };
  }
  return {
    width: Math.max(1, Math.round(region.width)),
    height: Math.max(1, Math.round(region.height))
  };
}
