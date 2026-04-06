import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ArtifactRecord } from "@jarvis/shared";
import {
  DesktopHostError,
  type DesktopDisplayRef,
  type DesktopHostAdapter,
  type DesktopHostExecutionContext,
  type DesktopWindowRef,
  type DeviceAudioGetInput,
  type DeviceAudioGetOutput,
  type DeviceAudioSetInput,
  type DeviceAudioSetOutput,
  type DeviceAppUsageInput,
  type DeviceAppUsageOutput,
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

type PowerShellRunner = (script: string) => Promise<string>;

export type PowerShellDesktopHostAdapterOptions = {
  runner?: PowerShellRunner;
  artifactRoot?: string;
  host?: {
    platform?: string;
    hostname?: string;
    user?: string;
  };
  waitAttempts?: number;
  waitDelayMs?: number;
};

type WindowSnapshot = DesktopWindowRef;

type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const DEFAULT_ARTIFACT_ROOT = path.join(os.homedir(), "Jarvis", "artifacts");
const DEFAULT_WAIT_ATTEMPTS = 20;
const DEFAULT_WAIT_DELAY_MS = 1000;

export class PowerShellDesktopHostAdapter implements DesktopHostAdapter {
  private readonly runner: PowerShellRunner;
  private readonly artifactRoot: string;
  private readonly host: { platform: string; hostname: string; user?: string };
  private readonly waitAttempts: number;
  private readonly waitDelayMs: number;

  constructor(options: PowerShellDesktopHostAdapterOptions = {}) {
    this.runner = options.runner ?? createDefaultPowerShellRunner();
    this.artifactRoot = options.artifactRoot ?? DEFAULT_ARTIFACT_ROOT;
    this.host = {
      platform: options.host?.platform ?? process.platform,
      hostname: options.host?.hostname ?? os.hostname(),
      user: options.host?.user ?? safeUserName()
    };
    this.waitAttempts = options.waitAttempts ?? DEFAULT_WAIT_ATTEMPTS;
    this.waitDelayMs = options.waitDelayMs ?? DEFAULT_WAIT_DELAY_MS;
  }

  async snapshot(
    input: DeviceSnapshotInput,
    _context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceSnapshotOutput>> {
    const windows = input.include?.windows === false ? [] : await this.listWindowsRaw();
    const displays = input.include?.displays === false ? [] : await this.getDisplays();
    const activeWindow =
      input.include?.active_window === false ? undefined : this.getActiveWindowFrom(windows);
    const clipboard = input.include?.clipboard ? await this.readClipboardSummary() : undefined;
    const artifacts: ArtifactRecord[] = [];
    let screenshot_artifact_id: string | undefined;

    if (input.capture_screenshot) {
      const capture = await this.captureScreenshot({
        target: "desktop",
        format: "png",
        output_name: input.output_name ?? `snapshot-${Date.now()}.png`
      });
      artifacts.push(capture.artifact);
      screenshot_artifact_id = capture.artifact.artifact_id;
    }

    return {
      summary: "Captured the current device snapshot.",
      artifacts: artifacts.length ? artifacts : undefined,
      structured_output: {
        host: this.host,
        observed_at: new Date().toISOString(),
        active_window: activeWindow,
        windows: input.include?.windows === false ? undefined : windows,
        displays: input.include?.displays === false ? undefined : displays,
        clipboard,
        screenshot_artifact_id
      }
    };
  }

  async listWindows(
    input: DeviceListWindowsInput,
    _context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceListWindowsOutput>> {
    const filtered = this.filterWindows(await this.listWindowsRaw(), input);
    return {
      summary: `Listed ${filtered.length} window(s).`,
      structured_output: { window_count: filtered.length, windows: filtered }
    };
  }

  async openApp(
    input: DeviceOpenAppInput,
    _context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceOpenAppOutput>> {
    const executable = input.app.executable ?? input.app.app_id ?? input.app.display_name;
    const appId = normalizeAppId(input.app.app_id ?? executable);
    if (!executable) {
      throw new DesktopHostError("APP_NOT_FOUND", "No app identifier was provided.");
    }

    const process_id = await this.startAppProcess(executable, input.arguments ?? []);
    if (!input.wait_for_window) {
      return {
        summary: `Launched ${input.app.display_name ?? executable}.`,
        structured_output: { launched: true, app_id: appId, process_id }
      };
    }

    const window = await this.waitForWindow(async () =>
      this.findWindowFrom(await this.listWindowsRaw(), {
        app_id: appId,
        title_contains: input.app.display_name ?? executable,
        strict_match: false
      })
    );
    if (!window) {
      throw new DesktopHostError("WINDOW_NOT_FOUND", `No window appeared for ${input.app.display_name ?? executable}.`);
    }

    return {
      summary: `Launched ${input.app.display_name ?? executable} and detected a window.`,
      structured_output: { launched: true, app_id: appId, process_id, window }
    };
  }

  async focusWindow(
    input: DeviceFocusWindowInput,
    _context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceFocusWindowOutput>> {
    const window = await this.findWindow(input);
    if (!window) {
      throw new DesktopHostError("WINDOW_NOT_FOUND", "No matching window was found.");
    }
    await this.focusWindowHandle(window.window_id);
    const focusedWindow = await this.findWindow({ window_id: window.window_id });
    if (!focusedWindow) {
      throw new DesktopHostError("WINDOW_NOT_FOUND", "The window disappeared before it could be focused.");
    }
    return { summary: `Focused ${focusedWindow.title}.`, structured_output: { focused: true, window: focusedWindow } };
  }

  async screenshot(
    input: DeviceScreenshotInput,
    _context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceScreenshotOutput>> {
    const capture = await this.captureScreenshot(input);
    return {
      summary: `Captured the ${input.target} screenshot.`,
      artifacts: [capture.artifact],
      structured_output: {
        capture_artifact_id: capture.artifact.artifact_id,
        target: input.target,
        format: input.format,
        width: capture.width,
        height: capture.height
      }
    };
  }

  async click(
    input: DeviceClickInput,
    _context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceClickOutput>> {
    if (input.x < 0 || input.y < 0) {
      throw new DesktopHostError("TARGET_OUT_OF_BOUNDS", "Pointer target is outside the visible coordinate space.");
    }
    const offset = await this.resolvePointerOffset(input);
    await this.runScript(`Set-CursorPos ${Math.round(input.x + offset.x)} ${Math.round(input.y + offset.y)}; Invoke-MouseClick ${quotePs(input.button ?? "left")} ${input.click_count ?? 1}`);
    return {
      summary: `Clicked ${input.button ?? "left"} at ${input.x}, ${input.y}.`,
      structured_output: {
        performed: true,
        button: input.button ?? "left",
        click_count: input.click_count ?? 1,
        window_id: input.window_id
      }
    };
  }

  async typeText(
    input: DeviceTypeTextInput,
    _context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceTypeTextOutput>> {
    if (input.window_id) {
      const window = await this.findWindow({ window_id: input.window_id });
      if (!window) {
        throw new DesktopHostError("WINDOW_NOT_FOUND", "No matching window was found.");
      }
      await this.focusWindowHandle(window.window_id);
    }

    if (input.mode === "paste") {
      await this.setClipboardText(input.text);
      await this.runScript(`Invoke-JarvisClipboardPaste ${input.submit ? "$true" : "$false"}`);
    } else {
      await this.runScript(`Invoke-JarvisSendKeysText @'${input.text}'@ ${input.submit ? "$true" : "$false"}`);
    }

    return {
      summary: `Typed ${input.text.length} characters.`,
      structured_output: {
        typed_characters: input.text.length,
        mode: input.mode ?? "insert",
        submitted: input.submit ?? false,
        window_id: input.window_id
      }
    };
  }

  async hotkey(
    input: DeviceHotkeyInput,
    _context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceHotkeyOutput>> {
    if (input.window_id) {
      const window = await this.findWindow({ window_id: input.window_id });
      if (!window) {
        throw new DesktopHostError("WINDOW_NOT_FOUND", "No matching window was found.");
      }
      await this.focusWindowHandle(window.window_id);
    }
    const normalized_keys = normalizeHotkey(input.keys);
    await this.runScript(`Invoke-JarvisSendKeys ${quotePs(toSendKeysChord(normalized_keys))}`);
    return {
      summary: `Sent hotkey ${normalized_keys.join("+")}.`,
      structured_output: { sent: true, normalized_keys, window_id: input.window_id }
    };
  }

  async clipboardGet(
    input: DeviceClipboardGetInput,
    _context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceClipboardGetOutput>> {
    const format = input.format ?? "text";
    if (format === "text" || format === "html") {
      const text = await this.readClipboardText();
      return { summary: `Read the clipboard as ${format}.`, structured_output: { format, has_value: Boolean(text), text } };
    }
    if (format === "files") {
      const files = await this.readClipboardFiles();
      return { summary: "Read the clipboard file list.", structured_output: { format, has_value: Boolean(files.length), files } };
    }
    const artifact = await this.readClipboardImageArtifact();
    return {
      summary: "Read the clipboard image.",
      artifacts: artifact ? [artifact] : undefined,
      structured_output: { format, has_value: Boolean(artifact), artifact_id: artifact?.artifact_id }
    };
  }

  async clipboardSet(
    input: DeviceClipboardSetInput,
    _context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceClipboardSetOutput>> {
    if (input.text !== undefined) {
      await this.setClipboardText(input.text);
      return { summary: "Updated the clipboard text.", structured_output: { applied: true, format: "text", item_count: input.text ? 1 : 0 } };
    }
    const filePaths = resolveClipboardPaths(input.files ?? []);
    await this.setClipboardFiles(filePaths);
    return { summary: "Updated the clipboard file list.", structured_output: { applied: true, format: "files", item_count: filePaths.length } };
  }

  async notify(
    input: DeviceNotifyInput,
    _context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceNotifyOutput>> {
    const notification_id = `notification-${randomUUID()}`;
    await this.runScript(`Show-Notification ${quotePs(input.title)} ${quotePs(input.body)} ${quotePs(input.urgency ?? "normal")}`);
    return { summary: `Sent notification ${input.title}.`, structured_output: { delivered: true, notification_id } };
  }

  async audioGet(
    _input: DeviceAudioGetInput,
    _context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceAudioGetOutput>> {
    const result = await this.runJson<{ volume: number; muted: boolean; device_id?: string; name?: string }>(
      "Get-JarvisAudio | ConvertTo-Json -Compress"
    );
    return {
      summary: `Volume ${result.volume}%${result.muted ? " (muted)" : ""}.`,
      structured_output: {
        volume: result.volume,
        muted: result.muted,
        default_device: result.device_id ? { device_id: result.device_id, name: result.name ?? result.device_id, is_default: true } : undefined,
      },
    };
  }

  async audioSet(
    input: DeviceAudioSetInput,
    _context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceAudioSetOutput>> {
    const args: string[] = [];
    if (input.volume !== undefined) args.push(`-Volume ${input.volume}`);
    if (input.mute !== undefined) args.push(`-Mute $${input.mute}`);
    if (input.device) args.push(`-Device ${quotePs(input.device)}`);
    await this.runScript(`Set-JarvisAudio ${args.join(" ")}`);
    return {
      summary: `Audio updated.`,
      structured_output: { applied: true, volume: input.volume ?? 0, muted: input.mute ?? false, device: input.device },
    };
  }

  async displayGet(
    _input: DeviceDisplayGetInput,
    _context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceDisplayGetOutput>> {
    const { getDisplay } = await import("./display.js");
    return getDisplay({}, (script) => this.runner(script));
  }

  async displaySet(
    input: DeviceDisplaySetInput,
    _context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceDisplaySetOutput>> {
    const { setDisplay } = await import("./display.js");
    return setDisplay(input, (script) => this.runner(script));
  }

  async powerAction(
    input: DevicePowerActionInput,
    _context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DevicePowerActionOutput>> {
    const cmds: Record<string, string> = {
      sleep: "rundll32.exe powrprof.dll,SetSuspendState 0,1,0",
      hibernate: "shutdown /h",
      shutdown: "shutdown /s /t 0",
      restart: "shutdown /r /t 0",
      lock: "rundll32.exe user32.dll,LockWorkStation",
    };
    const cmd = cmds[input.action];
    if (cmd) await this.runScript(`Start-Process -FilePath cmd -ArgumentList '/c ${cmd}' -WindowStyle Hidden`);
    return { summary: `Power action: ${input.action}.`, structured_output: { initiated: true, action: input.action } };
  }

  async networkStatus(
    input: DeviceNetworkStatusInput,
    _context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceNetworkStatusOutput>> {
    const filter = input.interface_name ? ` -Name ${quotePs(input.interface_name)}` : "";
    const interfaces = await this.runJson<Array<{ interface_name: string; status: "up" | "down" | "unknown"; ip_address?: string; mac_address?: string }>>(
      `Get-NetAdapter${filter} | Select-Object @{N='interface_name';E={$_.Name}},@{N='status';E={if($_.Status -eq 'Up'){'up'}else{'down'}}},@{N='ip_address';E={(Get-NetIPAddress -InterfaceAlias $_.Name -AddressFamily IPv4 -ErrorAction SilentlyContinue).IPAddress}},@{N='mac_address';E={$_.MacAddress}} | ConvertTo-Json -Compress`
    );
    return {
      summary: `${interfaces.length} network interface(s).`,
      structured_output: { interfaces: Array.isArray(interfaces) ? interfaces : [interfaces] },
    };
  }

  async networkControl(
    input: DeviceNetworkControlInput,
    _context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceNetworkControlOutput>> {
    if (input.ssid && input.action === "connect") {
      await this.runScript(`netsh wlan connect name=${quotePs(input.ssid)}`);
    } else if (input.action === "disconnect") {
      await this.runScript(`netsh wlan disconnect`);
    }
    return {
      summary: `Network ${input.action}: ${input.ssid ?? input.vpn_name ?? "default"}.`,
      structured_output: { applied: true, action: input.action, ssid: input.ssid, vpn_name: input.vpn_name },
    };
  }

  async windowLayout(
    input: DeviceWindowLayoutInput,
    _context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceWindowLayoutOutput>> {
    const targets = input.window_ids ?? [];
    await this.runScript(`Set-JarvisWindowLayout -Layout ${quotePs(input.layout)} -WindowIds @(${targets.map(quotePs).join(",")})`);
    return {
      summary: `Applied layout: ${input.layout}.`,
      structured_output: { applied: true, layout: input.layout, affected_count: targets.length },
    };
  }

  async virtualDesktopList(
    _input: DeviceVirtualDesktopListInput,
    _context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceVirtualDesktopListOutput>> {
    const desktops = await this.runJson<Array<{ desktop_id: string; name?: string; index?: number; is_current: boolean; window_count?: number }>>(
      "Get-JarvisVirtualDesktops | ConvertTo-Json -Compress"
    );
    const arr = Array.isArray(desktops) ? desktops : [desktops];
    return {
      summary: `${arr.length} virtual desktop(s).`,
      structured_output: { desktop_count: arr.length, desktops: arr },
    };
  }

  async virtualDesktopSwitch(
    input: DeviceVirtualDesktopSwitchInput,
    _context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceVirtualDesktopSwitchOutput>> {
    const arg = input.desktop_id ? `-Id ${quotePs(input.desktop_id)}` : `-Direction ${quotePs(input.direction ?? "next")}`;
    await this.runScript(`Switch-JarvisVirtualDesktop ${arg}`);
    return {
      summary: `Switched virtual desktop.`,
      structured_output: { switched: true, desktop: input.desktop_id ? { desktop_id: input.desktop_id, is_current: true } : undefined },
    };
  }

  async focusMode(
    input: DeviceFocusModeInput,
    _context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceFocusModeOutput>> {
    await this.runScript(`Set-JarvisFocusMode -Enabled $${input.enabled}${input.mute_notifications ? " -MuteNotifications $true" : ""}${input.duration_minutes ? ` -DurationMinutes ${input.duration_minutes}` : ""}`);
    const ends_at = input.duration_minutes
      ? new Date(Date.now() + input.duration_minutes * 60_000).toISOString()
      : undefined;
    return {
      summary: `Focus mode ${input.enabled ? "enabled" : "disabled"}.`,
      structured_output: { enabled: input.enabled, active: input.enabled, blocked_apps: input.blocked_apps, muted_notifications: input.mute_notifications, ends_at },
    };
  }

  async appUsage(
    input: DeviceAppUsageInput,
    _context: DesktopHostExecutionContext,
  ): Promise<ExecutionOutcome<DeviceAppUsageOutput>> {
    const hours = input.since_hours ?? 24;
    const topN = input.top_n ?? 10;
    const apps = await this.runJson<Array<{ app_id: string; display_name: string; duration_seconds: number; window_count?: number }>>(
      `Get-JarvisAppUsage -Hours ${hours} -Top ${topN}${input.app_filter ? ` -Filter ${quotePs(input.app_filter)}` : ""} | ConvertTo-Json -Compress`
    );
    const arr = Array.isArray(apps) ? apps : [apps];
    const total = arr.reduce((s, a) => s + a.duration_seconds, 0);
    return {
      summary: `Tracked ${arr.length} app(s), ${Math.round(total / 3600)}h total.`,
      structured_output: { apps: arr, total_tracked_seconds: total, since: new Date(Date.now() - hours * 3600_000).toISOString() },
    };
  }

  private async captureScreenshot(input: DeviceScreenshotInput): Promise<{ artifact: ArtifactRecord; width: number; height: number }> {
    const rect = await this.resolveCaptureRect(input);
    await mkdir(this.artifactRoot, { recursive: true });
    const outputPath = path.join(this.artifactRoot, input.output_name);
    const resolvedOutput = path.resolve(outputPath);
    const resolvedRoot = path.resolve(this.artifactRoot);
    if (!resolvedOutput.startsWith(resolvedRoot + path.sep) && resolvedOutput !== resolvedRoot) {
      throw new DesktopHostError(
        "INVALID_INPUT",
        `Output name "${input.output_name}" resolves outside the artifact root.`,
        false
      );
    }
    await this.runScript(`Save-Screenshot ${quotePs(outputPath)} ${rect.x} ${rect.y} ${rect.width} ${rect.height} ${quotePs(input.format)}`);
    const size = (await stat(outputPath)).size;
    return {
      artifact: {
        artifact_id: `artifact-${randomUUID()}`,
        kind: input.format,
        name: input.output_name,
        path: outputPath,
        path_context: "windows-host",
        path_style: "windows",
        size_bytes: size,
        created_at: new Date().toISOString()
      },
      width: rect.width,
      height: rect.height
    };
  }

  private async resolveCaptureRect(input: DeviceScreenshotInput): Promise<Rect> {
    switch (input.target) {
      case "desktop":
        return this.getDesktopBounds();
      case "display": {
        const displays = await this.getDisplays();
        const display = displays.find((item) => item.display_id === input.display_id) ?? displays.find((item) => item.is_primary) ?? displays[0];
        if (!display) {
          throw new DesktopHostError("CAPTURE_FAILED", "The requested display was not found.");
        }
        return { x: 0, y: 0, width: display.width, height: display.height };
      }
      case "active_window": {
        const window = this.getActiveWindowFrom(await this.listWindowsRaw());
        if (!window) {
          throw new DesktopHostError("WINDOW_NOT_FOUND", "No active window is available.");
        }
        return window.bounds ?? defaultBounds();
      }
      case "window": {
        const windows = await this.listWindowsRaw();
        const window = input.window_id ? windows.find((item) => item.window_id === input.window_id) : this.getActiveWindowFrom(windows);
        if (!window) {
          throw new DesktopHostError("WINDOW_NOT_FOUND", "No matching window was found.");
        }
        return window.bounds ?? defaultBounds();
      }
      case "region":
        if (!input.region) {
          throw new DesktopHostError("INVALID_INPUT", "A region was not provided.");
        }
        return {
          x: Math.round(input.region.x),
          y: Math.round(input.region.y),
          width: Math.max(1, Math.round(input.region.width)),
          height: Math.max(1, Math.round(input.region.height))
        };
      default:
        throw new DesktopHostError("INVALID_INPUT", `Unsupported capture target ${String(input.target)}.`);
    }
  }

  private async resolvePointerOffset(input: DeviceClickInput): Promise<{ x: number; y: number }> {
    if (input.coordinate_space !== "window") {
      return { x: 0, y: 0 };
    }
    const windows = await this.listWindowsRaw();
    const window = input.window_id ? windows.find((item) => item.window_id === input.window_id) : this.getActiveWindowFrom(windows);
    if (!window?.bounds) {
      throw new DesktopHostError("WINDOW_NOT_FOUND", "No matching window is available.");
    }
    return { x: window.bounds.x, y: window.bounds.y };
  }

  private async findWindow(input: { window_id?: string; title_contains?: string; app_id?: string; strict_match?: boolean }): Promise<WindowSnapshot | undefined> {
    return this.findWindowFrom(await this.listWindowsRaw(), input);
  }

  private findWindowFrom(windows: WindowSnapshot[], input: { window_id?: string; title_contains?: string; app_id?: string; strict_match?: boolean }): WindowSnapshot | undefined {
    const titleContains = input.title_contains?.toLowerCase();
    const appId = input.app_id?.toLowerCase();
    return windows.find((window) => {
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

  private filterWindows(windows: WindowSnapshot[], input: DeviceListWindowsInput): WindowSnapshot[] {
    const titleContains = input.title_contains?.toLowerCase();
    const appId = input.app_id?.toLowerCase();
    return windows
      .filter((window) => input.include_minimized || !window.is_minimized)
      .filter((window) => (titleContains ? window.title.toLowerCase().includes(titleContains) : true))
      .filter((window) => (appId ? window.app_id?.toLowerCase() === appId : true))
      .map((window) => cloneWindow(window));
  }

  private async waitForWindow(
    finder: () => Promise<WindowSnapshot | undefined>,
  ): Promise<WindowSnapshot | undefined> {
    for (let attempt = 0; attempt < this.waitAttempts; attempt += 1) {
      const match = await finder();
      if (match) {
        return match;
      }
      await new Promise((resolve) => setTimeout(resolve, this.waitDelayMs));
    }
    return undefined;
  }

  private async listWindowsRaw(): Promise<WindowSnapshot[]> {
    return this.runJson<WindowSnapshot[]>("Get-JarvisWindows");
  }

  private async getDisplays(): Promise<DesktopDisplayRef[]> {
    return this.runJson<DesktopDisplayRef[]>("Get-JarvisDisplays");
  }

  private async getDesktopBounds(): Promise<Rect> {
    return this.runJson<Rect>("Get-JarvisDesktopBounds");
  }

  private getActiveWindowFrom(windows: WindowSnapshot[]): WindowSnapshot | undefined {
    return windows.find((window) => window.is_focused) ?? windows[0];
  }

  private async startAppProcess(executable: string, arguments_: string[]): Promise<number> {
    const result = await this.runJson<{ process_id?: number }>(
      `Start-JarvisApp ${quotePs(executable)} @(${arguments_.map(quotePs).join(", ")})`,
    );
    return result.process_id ?? 0;
  }

  private async readClipboardText(): Promise<string | undefined> {
    const value = await this.runJson<{ text?: string }>("Read-JarvisClipboardText");
    return value.text;
  }

  private async readClipboardSummary(): Promise<{ has_text: boolean; text_preview?: string }> {
    const text = await this.readClipboardText();
    return { has_text: Boolean(text), text_preview: text?.slice(0, 120) };
  }

  private async readClipboardFiles(): Promise<string[]> {
    const value = await this.runJson<{ files?: string[] }>("Read-JarvisClipboardFiles");
    return value.files ?? [];
  }

  private async readClipboardImageArtifact(): Promise<ArtifactRecord | undefined> {
    const value = await this.runJson<{ artifact?: ArtifactRecord }>("Read-JarvisClipboardImage");
    return value.artifact;
  }

  private async setClipboardText(text: string): Promise<void> {
    await this.runScript(`Write-JarvisClipboardText ${quotePs(text)}`);
  }

  private async setClipboardFiles(filePaths: string[]): Promise<void> {
    await this.runScript(`Write-JarvisClipboardFiles @(${filePaths.map(quotePs).join(", ")})`);
  }

  private async focusWindowHandle(windowId: string): Promise<void> {
    const handle = parseWindowHandle(windowId);
    if (handle === null) {
      throw new DesktopHostError("WINDOW_NOT_FOUND", `Unable to parse window id ${windowId}.`);
    }
    await this.runScript(`Focus-JarvisWindow ${handle}`);
  }

  private async runJson<T>(body: string): Promise<T> {
    const output = await this.runner(buildJsonScript(body));
    if (!output.trim()) {
      throw new DesktopHostError("CAPTURE_FAILED", "The desktop host did not return any output.");
    }
    try {
      return JSON.parse(output) as T;
    } catch {
      throw new DesktopHostError("CAPTURE_FAILED", "The desktop host returned invalid JSON.", false, { output });
    }
  }

  private async runScript(body: string): Promise<void> {
    await this.runner(buildScript(body));
  }
}

export function createPowerShellDesktopHostAdapter(
  options: PowerShellDesktopHostAdapterOptions = {},
): PowerShellDesktopHostAdapter {
  return new PowerShellDesktopHostAdapter(options);
}

function createDefaultPowerShellRunner(): PowerShellRunner {
  return async (script) => {
    const command = process.platform === "win32" ? "powershell.exe" : "pwsh";
    return await new Promise<string>((resolve, reject) => {
      const child = spawn(command, [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        script
      ], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      const MAX_BUFFER_BYTES = 10 * 1024 * 1024;
      let stdout = "";
      let stderr = "";
      let totalBytes = 0;
      let killed = false;
      child.stdout.on("data", (chunk) => {
        const text = chunk.toString("utf8");
        totalBytes += Buffer.byteLength(text, "utf8");
        if (totalBytes > MAX_BUFFER_BYTES && !killed) {
          killed = true;
          child.kill("SIGTERM");
          reject(new DesktopHostError("CAPTURE_FAILED", "PowerShell output exceeded the 10 MB buffer limit.", false));
          return;
        }
        stdout += text;
      });
      child.stderr.on("data", (chunk) => {
        const text = chunk.toString("utf8");
        totalBytes += Buffer.byteLength(text, "utf8");
        if (totalBytes > MAX_BUFFER_BYTES && !killed) {
          killed = true;
          child.kill("SIGTERM");
          reject(new DesktopHostError("CAPTURE_FAILED", "PowerShell output exceeded the 10 MB buffer limit.", false));
          return;
        }
        stderr += text;
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (killed) return;
        if (code !== 0) {
          reject(new DesktopHostError("CAPTURE_FAILED", `PowerShell exited with code ${code}.`, false, { stderr, stdout }));
          return;
        }
        resolve(stdout.trim());
      });
    });
  };
}

function buildScript(body: string): string {
  return `${POWER_SHELL_PRELUDE}\n${body}\n`;
}

function buildJsonScript(body: string): string {
  return `${buildScript(body)} | ConvertTo-Json -Depth 8 -Compress`;
}

function quotePs(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function normalizeHotkey(keys: string[]): string[] {
  return uniquePreservingOrder(keys.map((key) => key.trim().toLowerCase()));
}

function toSendKeysChord(keys: string[]): string {
  return keys
    .map((key) => {
      switch (key) {
        case "ctrl":
        case "control":
          return "^";
        case "shift":
          return "+";
        case "alt":
          return "%";
        case "win":
        case "meta":
        case "cmd":
          return "#";
        case "enter":
          return "{ENTER}";
        case "tab":
          return "{TAB}";
        case "esc":
        case "escape":
          return "{ESC}";
        case "backspace":
          return "{BACKSPACE}";
        case "delete":
          return "{DELETE}";
        case "up":
          return "{UP}";
        case "down":
          return "{DOWN}";
        case "left":
          return "{LEFT}";
        case "right":
          return "{RIGHT}";
        default:
          return key.length === 1 ? key : `{${key.toUpperCase()}}`;
      }
    })
    .join("");
}

function parseWindowHandle(windowId: string): number | null {
  const match = /^hwnd:(\d+)$/i.exec(windowId);
  return match ? Number(match[1]) : null;
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
  return value.replaceAll("\\", "/").split("/").at(-1)?.replace(/\.[a-z0-9]+$/i, "").trim().toLowerCase();
}

function cloneWindow(window: DesktopWindowRef): DesktopWindowRef {
  return { ...window, bounds: window.bounds ? { ...window.bounds } : undefined };
}

function resolveClipboardPaths(files: NonNullable<DeviceClipboardSetInput["files"]>): string[] {
  const paths = files.map((file) => file.path).filter((value): value is string => Boolean(value));
  if (!paths.length) {
    throw new DesktopHostError("INVALID_INPUT", "Clipboard file entries must include a local path.");
  }
  return paths;
}

function defaultBounds(): Rect {
  return { x: 0, y: 0, width: 1280, height: 720 };
}

function safeUserName(): string | undefined {
  try {
    return os.userInfo().username;
  } catch {
    return undefined;
  }
}

const POWER_SHELL_PRELUDE = String.raw`
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class JarvisDesktopNative {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@ -Language CSharp
function Set-CursorPos([int]$x, [int]$y) { [void][JarvisDesktopNative]::SetCursorPos($x, $y) }
function Get-JarvisWindows {
  $foreground = [JarvisDesktopNative]::GetForegroundWindow()
  Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } | ForEach-Object {
    $rect = New-Object JarvisDesktopNative+RECT
    $bounds = @{ x = 0; y = 0; width = 1280; height = 720 }
    if ([JarvisDesktopNative]::GetWindowRect([IntPtr]$_.MainWindowHandle, [ref]$rect)) {
      $bounds = @{ x = $rect.Left; y = $rect.Top; width = [Math]::Max(1, $rect.Right - $rect.Left); height = [Math]::Max(1, $rect.Bottom - $rect.Top) }
    }
    [pscustomobject]@{
      window_id = "hwnd:$($_.MainWindowHandle)"
      title = $_.MainWindowTitle
      app_id = ($_.ProcessName).ToLower()
      process_id = $_.Id
      is_focused = ($_.MainWindowHandle -eq $foreground)
      is_minimized = [JarvisDesktopNative]::IsIconic([IntPtr]$_.MainWindowHandle)
      bounds = $bounds
    }
  }
}
function Get-JarvisDisplays {
  [System.Windows.Forms.Screen]::AllScreens | ForEach-Object {
    [pscustomobject]@{ display_id = $_.DeviceName; width = $_.Bounds.Width; height = $_.Bounds.Height; scale_factor = 1; is_primary = $_.Primary }
  }
}
function Get-JarvisDesktopBounds {
  [pscustomobject]@{
    x = [System.Windows.Forms.SystemInformation]::VirtualScreen.X
    y = [System.Windows.Forms.SystemInformation]::VirtualScreen.Y
    width = [System.Windows.Forms.SystemInformation]::VirtualScreen.Width
    height = [System.Windows.Forms.SystemInformation]::VirtualScreen.Height
  }
}
function Focus-JarvisWindow([int]$handle) { if ($handle -le 0) { throw "Invalid window handle." }; [void][JarvisDesktopNative]::ShowWindowAsync([IntPtr]$handle, 9); [void][JarvisDesktopNative]::SetForegroundWindow([IntPtr]$handle) }
function Start-JarvisApp([string]$executable, [string[]]$arguments) { $proc = Start-Process -FilePath $executable -ArgumentList $arguments -PassThru; [pscustomobject]@{ process_id = $proc.Id } }
function Read-JarvisClipboardText { try { $text = Get-Clipboard -Raw } catch { $text = $null }; [pscustomobject]@{ text = $text } }
function Write-JarvisClipboardText([string]$text) { Set-Clipboard -Value $text }
function Read-JarvisClipboardFiles { try { $items = Get-Clipboard -Format FileDropList; $files = @($items) } catch { $files = @() }; [pscustomobject]@{ files = $files } }
function Write-JarvisClipboardFiles([string[]]$paths) { Set-Clipboard -Path $paths }
function Read-JarvisClipboardImage {
  try {
    if ([System.Windows.Forms.Clipboard]::ContainsImage()) {
      $image = [System.Windows.Forms.Clipboard]::GetImage()
      $path = Join-Path $env:TEMP ("jarvis-clipboard-" + [guid]::NewGuid().ToString("N") + ".png")
      $image.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
      $file = Get-Item $path
      [pscustomobject]@{ artifact = @{ artifact_id = ("artifact-" + [guid]::NewGuid().ToString("N")); kind = "png"; name = $file.Name; path = $file.FullName; path_context = "windows-host"; path_style = "windows"; size_bytes = [int64]$file.Length; created_at = [DateTime]::UtcNow.ToString("o") } }
    } else { [pscustomobject]@{ artifact = $null } }
  } catch { [pscustomobject]@{ artifact = $null } }
}
function Invoke-JarvisSendKeysText([string]$text, [bool]$submit) { [System.Windows.Forms.SendKeys]::SendWait($text); if ($submit) { [System.Windows.Forms.SendKeys]::SendWait("{ENTER}") } }
function Invoke-JarvisSendKeys([string]$keys) { [System.Windows.Forms.SendKeys]::SendWait($keys) }
function Invoke-JarvisClipboardPaste([bool]$submit) { [System.Windows.Forms.SendKeys]::SendWait("^v"); if ($submit) { [System.Windows.Forms.SendKeys]::SendWait("{ENTER}") } }
function Invoke-MouseClick([string]$button, [int]$clickCount) {
  $down = 0x0002; $up = 0x0004
  switch ($button) { "right" { $down = 0x0008; $up = 0x0010 } "middle" { $down = 0x0020; $up = 0x0040 } }
  for ($i = 0; $i -lt $clickCount; $i++) { [JarvisDesktopNative]::mouse_event($down, 0, 0, 0, [UIntPtr]::Zero); [JarvisDesktopNative]::mouse_event($up, 0, 0, 0, [UIntPtr]::Zero) }
}
function Save-Screenshot([string]$path, [int]$x, [int]$y, [int]$width, [int]$height, [string]$format) {
  $dir = Split-Path -Parent $path
  if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $bitmap = New-Object System.Drawing.Bitmap($width, $height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try { $graphics.CopyFromScreen($x, $y, 0, 0, $bitmap.Size); if ($format -eq "jpeg") { $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Jpeg) } else { $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png) } }
  finally { $graphics.Dispose(); $bitmap.Dispose() }
}
function Show-Notification([string]$title, [string]$body, [string]$urgency) {
  $notify = New-Object System.Windows.Forms.NotifyIcon
  $notify.Icon = [System.Drawing.SystemIcons]::Information
  $notify.Visible = $true
  $notify.BalloonTipTitle = $title
  $notify.BalloonTipText = $body
  $notify.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
  $notify.ShowBalloonTip(4000)
  Start-Sleep -Milliseconds 200
  $notify.Dispose()
}
`;
