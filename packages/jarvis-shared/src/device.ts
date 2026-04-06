import type { OpenClawPluginToolContext } from "openclaw/plugin-sdk/plugin-entry";
import { getJarvisState } from "./state.js";
import type { ToolResponse } from "./types.js";

export type DeviceSnapshotParams = {
  includeWindows?: boolean;
  includeDisplays?: boolean;
  includeClipboard?: boolean;
  includeActiveWindow?: boolean;
  captureScreenshot?: boolean;
  outputName?: string;
};

export type DeviceListWindowsParams = {
  includeMinimized?: boolean;
  titleContains?: string;
  appId?: string;
};

export type DeviceOpenAppParams = {
  appId?: string;
  executable?: string;
  displayName?: string;
  arguments?: string[];
  waitForWindow?: boolean;
};

export type DeviceFocusWindowParams = {
  windowId?: string;
  titleContains?: string;
  appId?: string;
  strictMatch?: boolean;
};

export type DeviceRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DeviceScreenshotParams = {
  target?: "desktop" | "active_window" | "window" | "display" | "region";
  windowId?: string;
  displayId?: string;
  region?: DeviceRegion;
  format?: "png" | "jpeg";
  outputName: string;
};

export type DeviceClickParams = {
  x: number;
  y: number;
  coordinateSpace?: "screen" | "window";
  windowId?: string;
  button?: "left" | "right" | "middle";
  clickCount?: number;
};

export type DeviceTypeParams = {
  text: string;
  mode?: "insert" | "replace" | "paste";
  submit?: boolean;
  windowId?: string;
};

export type DeviceHotkeyParams = {
  keys: string[];
  windowId?: string;
};

export type DeviceClipboardGetParams = {
  format?: "text" | "html" | "files" | "image";
};

export type DeviceClipboardSetParams = {
  text?: string;
  artifactIds?: string[];
  mode?: "replace";
};

export type DeviceNotifyParams = {
  title: string;
  body: string;
  urgency?: "low" | "normal" | "high";
};

export function submitDeviceSnapshot(
  ctx: OpenClawPluginToolContext | undefined,
  params: DeviceSnapshotParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "device.snapshot",
    input: {
      include: {
        windows: params.includeWindows ?? true,
        displays: params.includeDisplays ?? true,
        clipboard: params.includeClipboard ?? false,
        active_window: params.includeActiveWindow ?? true
      },
      capture_screenshot: params.captureScreenshot ?? false,
      output_name: params.outputName
    }
  });
}

export function submitDeviceListWindows(
  ctx: OpenClawPluginToolContext | undefined,
  params: DeviceListWindowsParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "device.list_windows",
    input: {
      include_minimized: params.includeMinimized ?? false,
      title_contains: params.titleContains,
      app_id: params.appId
    }
  });
}

export function submitDeviceOpenApp(
  ctx: OpenClawPluginToolContext | undefined,
  params: DeviceOpenAppParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "device.open_app",
    input: {
      app: {
        app_id: params.appId,
        executable: params.executable,
        display_name: params.displayName
      },
      arguments: params.arguments ?? [],
      wait_for_window: params.waitForWindow ?? true
    }
  });
}

export function submitDeviceFocusWindow(
  ctx: OpenClawPluginToolContext | undefined,
  params: DeviceFocusWindowParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "device.focus_window",
    input: {
      window_id: params.windowId,
      title_contains: params.titleContains,
      app_id: params.appId,
      strict_match: params.strictMatch ?? false
    }
  });
}

export function submitDeviceScreenshot(
  ctx: OpenClawPluginToolContext | undefined,
  params: DeviceScreenshotParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "device.screenshot",
    input: {
      target: params.target ?? "desktop",
      window_id: params.windowId,
      display_id: params.displayId,
      region: params.region,
      format: params.format ?? "png",
      output_name: params.outputName
    }
  });
}

export function submitDeviceClick(
  ctx: OpenClawPluginToolContext | undefined,
  params: DeviceClickParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "device.click",
    input: {
      x: params.x,
      y: params.y,
      coordinate_space: params.coordinateSpace ?? "screen",
      window_id: params.windowId,
      button: params.button ?? "left",
      click_count: params.clickCount ?? 1
    }
  });
}

export function submitDeviceType(
  ctx: OpenClawPluginToolContext | undefined,
  params: DeviceTypeParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "device.type_text",
    input: {
      text: params.text,
      mode: params.mode ?? "insert",
      submit: params.submit ?? false,
      window_id: params.windowId
    }
  });
}

export function submitDeviceHotkey(
  ctx: OpenClawPluginToolContext | undefined,
  params: DeviceHotkeyParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "device.hotkey",
    input: {
      keys: params.keys,
      window_id: params.windowId
    }
  });
}

export function submitDeviceClipboardGet(
  ctx: OpenClawPluginToolContext | undefined,
  params: DeviceClipboardGetParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "device.clipboard_get",
    input: {
      format: params.format ?? "text"
    }
  });
}

export function submitDeviceClipboardSet(
  ctx: OpenClawPluginToolContext | undefined,
  params: DeviceClipboardSetParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "device.clipboard_set",
    input: {
      text: params.text,
      files: (params.artifactIds ?? []).map((artifactId) => ({
        artifact_id: artifactId
      })),
      mode: params.mode ?? "replace"
    },
    artifactsIn: (params.artifactIds ?? []).map((artifactId) => ({
      artifact_id: artifactId
    }))
  });
}

export function submitDeviceNotify(
  ctx: OpenClawPluginToolContext | undefined,
  params: DeviceNotifyParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "device.notify",
    input: {
      title: params.title,
      body: params.body,
      urgency: params.urgency ?? "normal"
    }
  });
}

export type DeviceAudioGetParams = Record<string, never>;
export type DeviceAudioSetParams = { volume?: number; mute?: boolean; device?: string };
export type DeviceDisplayGetParams = Record<string, never>;
export type DeviceDisplaySetParams = { displayId?: string; brightness?: number; resolution?: { width: number; height: number } };
export type DevicePowerActionParams = { action: "sleep" | "hibernate" | "shutdown" | "restart" | "lock" };
export type DeviceNetworkStatusParams = { interfaceName?: string };
export type DeviceNetworkControlParams = { action: "connect" | "disconnect"; ssid?: string; vpnName?: string };
export type DeviceWindowLayoutParams = { layout: "snap_left" | "snap_right" | "maximize" | "minimize" | "restore" | "tile_grid"; windowIds?: string[] };
export type DeviceVirtualDesktopListParams = Record<string, never>;
export type DeviceVirtualDesktopSwitchParams = { desktopId?: string; direction?: "next" | "previous" };

export function submitDeviceAudioGet(
  ctx: OpenClawPluginToolContext | undefined,
  _params: DeviceAudioGetParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "device.audio_get",
    input: {}
  });
}

export function submitDeviceAudioSet(
  ctx: OpenClawPluginToolContext | undefined,
  params: DeviceAudioSetParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "device.audio_set",
    input: {
      volume: params.volume,
      mute: params.mute,
      device: params.device
    }
  });
}

export function submitDeviceDisplayGet(
  ctx: OpenClawPluginToolContext | undefined,
  _params: DeviceDisplayGetParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "device.display_get",
    input: {}
  });
}

export function submitDeviceDisplaySet(
  ctx: OpenClawPluginToolContext | undefined,
  params: DeviceDisplaySetParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "device.display_set",
    input: {
      display_id: params.displayId,
      brightness: params.brightness,
      resolution: params.resolution
    }
  });
}

export function submitDevicePowerAction(
  ctx: OpenClawPluginToolContext | undefined,
  params: DevicePowerActionParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "device.power_action",
    input: {
      action: params.action
    }
  });
}

export function submitDeviceNetworkStatus(
  ctx: OpenClawPluginToolContext | undefined,
  params: DeviceNetworkStatusParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "device.network_status",
    input: {
      interface_name: params.interfaceName
    }
  });
}

export function submitDeviceNetworkControl(
  ctx: OpenClawPluginToolContext | undefined,
  params: DeviceNetworkControlParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "device.network_control",
    input: {
      action: params.action,
      ssid: params.ssid,
      vpn_name: params.vpnName
    }
  });
}

export function submitDeviceWindowLayout(
  ctx: OpenClawPluginToolContext | undefined,
  params: DeviceWindowLayoutParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "device.window_layout",
    input: {
      layout: params.layout,
      window_ids: params.windowIds
    }
  });
}

export function submitDeviceVirtualDesktopList(
  ctx: OpenClawPluginToolContext | undefined,
  _params: DeviceVirtualDesktopListParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "device.virtual_desktop_list",
    input: {}
  });
}

export function submitDeviceVirtualDesktopSwitch(
  ctx: OpenClawPluginToolContext | undefined,
  params: DeviceVirtualDesktopSwitchParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "device.virtual_desktop_switch",
    input: {
      desktop_id: params.desktopId,
      direction: params.direction
    }
  });
}

export type DeviceFocusModeParams = {
  enabled: boolean;
  blockedApps?: string[];
  muteNotifications?: boolean;
  durationMinutes?: number;
};

export type DeviceAppUsageParams = {
  sinceHours?: number;
  topN?: number;
  appFilter?: string;
};

export function submitDeviceFocusMode(
  ctx: OpenClawPluginToolContext | undefined,
  params: DeviceFocusModeParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "device.focus_mode",
    input: {
      enabled: params.enabled,
      blocked_apps: params.blockedApps,
      mute_notifications: params.muteNotifications,
      duration_minutes: params.durationMinutes
    }
  });
}

export function submitDeviceAppUsage(
  ctx: OpenClawPluginToolContext | undefined,
  params: DeviceAppUsageParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "device.app_usage",
    input: {
      since_hours: params.sinceHours,
      top_n: params.topN,
      app_filter: params.appFilter
    }
  });
}
