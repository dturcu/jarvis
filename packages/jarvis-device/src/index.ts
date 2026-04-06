import { Type } from "@sinclair/typebox";
import {
  definePluginEntry,
  type AnyAgentTool,
  type OpenClawPluginToolContext,
  type PluginCommandContext
} from "openclaw/plugin-sdk/plugin-entry";
import {
  DEVICE_COMMAND_NAMES,
  DEVICE_TOOL_NAMES,
  getJarvisState,
  safeJsonParse,
  submitDeviceClick,
  submitDeviceClipboardGet,
  submitDeviceClipboardSet,
  submitDeviceFocusWindow,
  submitDeviceHotkey,
  submitDeviceListWindows,
  submitDeviceNotify,
  submitDeviceOpenApp,
  submitDeviceScreenshot,
  submitDeviceSnapshot,
  submitDeviceType,
  toCommandReply,
  toToolResult,
  type DeviceClickParams,
  type DeviceClipboardGetParams,
  type DeviceClipboardSetParams,
  type DeviceFocusWindowParams,
  type DeviceHotkeyParams,
  type DeviceListWindowsParams,
  type DeviceNotifyParams,
  type DeviceOpenAppParams,
  type DeviceScreenshotParams,
  type DeviceSnapshotParams,
  type DeviceTypeParams,
  type ToolResponse
} from "@jarvis/shared";

type DeviceCommandArgs = {
  operation:
    | "snapshot"
    | "open_app"
    | "screenshot"
    | "click"
    | "type"
    | "hotkey";
  includeWindows?: boolean;
  includeDisplays?: boolean;
  includeClipboard?: boolean;
  includeActiveWindow?: boolean;
  captureScreenshot?: boolean;
  outputName?: string;
  appId?: string;
  executable?: string;
  displayName?: string;
  arguments?: string[];
  waitForWindow?: boolean;
  target?: DeviceScreenshotParams["target"];
  windowId?: string;
  displayId?: string;
  region?: DeviceScreenshotParams["region"];
  format?: DeviceScreenshotParams["format"];
  x?: number;
  y?: number;
  coordinateSpace?: DeviceClickParams["coordinateSpace"];
  button?: DeviceClickParams["button"];
  clickCount?: number;
  text?: string;
  mode?: DeviceTypeParams["mode"];
  submit?: boolean;
  keys?: string[];
};

type WindowsCommandArgs = {
  operation: "list" | "focus";
  includeMinimized?: boolean;
  titleContains?: string;
  appId?: string;
  windowId?: string;
  strictMatch?: boolean;
};

type ClipboardCommandArgs = {
  operation: "get" | "set";
  format?: DeviceClipboardGetParams["format"];
  text?: string;
  artifactIds?: string[];
  mode?: DeviceClipboardSetParams["mode"];
};

function asLiteralUnion<const Values extends readonly [string, ...string[]]>(
  values: Values,
) {
  return Type.Union(values.map((value) => Type.Literal(value)) as [any, any, ...any[]]);
}

const screenshotTargetSchema = asLiteralUnion([
  "desktop",
  "active_window",
  "window",
  "display",
  "region"
] as const);
const screenshotFormatSchema = asLiteralUnion(["png", "jpeg"] as const);
const coordinateSpaceSchema = asLiteralUnion(["screen", "window"] as const);
const clickButtonSchema = asLiteralUnion(["left", "right", "middle"] as const);
const typeModeSchema = asLiteralUnion(["insert", "replace", "paste"] as const);
const clipboardFormatSchema = asLiteralUnion(["text", "html", "files", "image"] as const);
const urgencySchema = asLiteralUnion(["low", "normal", "high"] as const);

const regionSchema = Type.Object({
  x: Type.Number(),
  y: Type.Number(),
  width: Type.Number({ exclusiveMinimum: 0 }),
  height: Type.Number({ exclusiveMinimum: 0 })
});

function createDeviceTool(
  ctx: OpenClawPluginToolContext,
  name: string,
  label: string,
  description: string,
  parameters: ReturnType<typeof Type.Object>,
  submit: (ctx: OpenClawPluginToolContext | undefined, params: any) => ToolResponse,
): AnyAgentTool {
  return {
    name,
    label,
    description,
    parameters,
    execute: async (_toolCallId, params) => toToolResult(submit(ctx, params))
  };
}

export function createDeviceTools(
  ctx: OpenClawPluginToolContext,
): AnyAgentTool[] {
  return [
    createDeviceTool(
      ctx,
      "device_snapshot",
      "Device Snapshot",
      "Capture a structured snapshot of the current device state.",
      Type.Object({
        includeWindows: Type.Optional(Type.Boolean()),
        includeDisplays: Type.Optional(Type.Boolean()),
        includeClipboard: Type.Optional(Type.Boolean()),
        includeActiveWindow: Type.Optional(Type.Boolean()),
        captureScreenshot: Type.Optional(Type.Boolean()),
        outputName: Type.Optional(Type.String({ minLength: 1 }))
      }),
      submitDeviceSnapshot
    ),
    createDeviceTool(
      ctx,
      "device_list_windows",
      "Device List Windows",
      "List visible desktop windows on the current device.",
      Type.Object({
        includeMinimized: Type.Optional(Type.Boolean()),
        titleContains: Type.Optional(Type.String({ minLength: 1 })),
        appId: Type.Optional(Type.String({ minLength: 1 }))
      }),
      submitDeviceListWindows
    ),
    createDeviceTool(
      ctx,
      "device_open_app",
      "Device Open App",
      "Launch a desktop application through the external desktop host worker.",
      Type.Object({
        appId: Type.Optional(Type.String({ minLength: 1 })),
        executable: Type.Optional(Type.String({ minLength: 1 })),
        displayName: Type.Optional(Type.String({ minLength: 1 })),
        arguments: Type.Optional(Type.Array(Type.String())),
        waitForWindow: Type.Optional(Type.Boolean())
      }),
      submitDeviceOpenApp
    ),
    createDeviceTool(
      ctx,
      "device_focus_window",
      "Device Focus Window",
      "Bring a matching desktop window to the foreground.",
      Type.Object({
        windowId: Type.Optional(Type.String({ minLength: 1 })),
        titleContains: Type.Optional(Type.String({ minLength: 1 })),
        appId: Type.Optional(Type.String({ minLength: 1 })),
        strictMatch: Type.Optional(Type.Boolean())
      }),
      submitDeviceFocusWindow
    ),
    createDeviceTool(
      ctx,
      "device_screenshot",
      "Device Screenshot",
      "Capture a screenshot from the desktop, a display, a window, or a region.",
      Type.Object({
        target: Type.Optional(screenshotTargetSchema),
        windowId: Type.Optional(Type.String({ minLength: 1 })),
        displayId: Type.Optional(Type.String({ minLength: 1 })),
        region: Type.Optional(regionSchema),
        format: Type.Optional(screenshotFormatSchema),
        outputName: Type.String({ minLength: 1 })
      }),
      submitDeviceScreenshot
    ),
    createDeviceTool(
      ctx,
      "device_click",
      "Device Click",
      "Inject a mouse click at approved coordinates on the current device.",
      Type.Object({
        x: Type.Number(),
        y: Type.Number(),
        coordinateSpace: Type.Optional(coordinateSpaceSchema),
        windowId: Type.Optional(Type.String({ minLength: 1 })),
        button: Type.Optional(clickButtonSchema),
        clickCount: Type.Optional(Type.Integer({ minimum: 1, maximum: 5 }))
      }),
      submitDeviceClick
    ),
    createDeviceTool(
      ctx,
      "device_type",
      "Device Type",
      "Type text into the current device through the desktop host worker.",
      Type.Object({
        text: Type.String({ minLength: 1 }),
        mode: Type.Optional(typeModeSchema),
        submit: Type.Optional(Type.Boolean()),
        windowId: Type.Optional(Type.String({ minLength: 1 }))
      }),
      submitDeviceType
    ),
    createDeviceTool(
      ctx,
      "device_hotkey",
      "Device Hotkey",
      "Send a keyboard shortcut to the current device.",
      Type.Object({
        keys: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
        windowId: Type.Optional(Type.String({ minLength: 1 }))
      }),
      submitDeviceHotkey
    ),
    createDeviceTool(
      ctx,
      "device_clipboard_get",
      "Device Clipboard Get",
      "Read the current clipboard through the desktop host worker.",
      Type.Object({
        format: Type.Optional(clipboardFormatSchema)
      }),
      submitDeviceClipboardGet
    ),
    createDeviceTool(
      ctx,
      "device_clipboard_set",
      "Device Clipboard Set",
      "Write text or file references to the device clipboard.",
      Type.Object({
        text: Type.Optional(Type.String()),
        artifactIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
        mode: Type.Optional(Type.Literal("replace"))
      }),
      submitDeviceClipboardSet
    ),
    createDeviceTool(
      ctx,
      "device_notify",
      "Device Notify",
      "Send a local desktop notification through the host worker.",
      Type.Object({
        title: Type.String({ minLength: 1 }),
        body: Type.String({ minLength: 1 }),
        urgency: Type.Optional(urgencySchema)
      }),
      submitDeviceNotify
    )
  ];
}

function formatJobReply(response: ToolResponse): string {
  const parts = [response.summary];
  if (response.job_id) {
    parts.push(`job=${response.job_id}`);
  }
  if (response.approval_id) {
    parts.push(`approval=${response.approval_id}`);
  }
  return parts.join(" | ");
}

function parseJsonArgs<T>(ctx: PluginCommandContext): T | null {
  return safeJsonParse<T>(ctx.args);
}

function toToolContext(ctx: PluginCommandContext): OpenClawPluginToolContext {
  return {
    sessionKey: ctx.sessionKey,
    sessionId: ctx.sessionId,
    messageChannel: ctx.channel,
    requesterSenderId: ctx.senderId
  };
}

function missingJsonReply(commandName: string, usage: string) {
  return toCommandReply(`Usage: /${commandName} ${usage}`, true);
}

function invalidJsonReply(commandName: string) {
  return toCommandReply(`Invalid JSON arguments for /${commandName}.`, true);
}

export function createDeviceCommand() {
  return {
    name: "device",
    description: "Submit a deterministic device job spec from JSON arguments.",
    acceptsArgs: true,
    handler: (ctx: PluginCommandContext) => {
      const args = parseJsonArgs<DeviceCommandArgs>(ctx);
      if (!args) {
        return invalidJsonReply("device");
      }

      switch (args.operation) {
        case "snapshot": {
          const response = submitDeviceSnapshot(toToolContext(ctx), {
            includeWindows: args.includeWindows,
            includeDisplays: args.includeDisplays,
            includeClipboard: args.includeClipboard,
            includeActiveWindow: args.includeActiveWindow,
            captureScreenshot: args.captureScreenshot,
            outputName: args.outputName
          });
          return toCommandReply(formatJobReply(response));
        }
        case "open_app": {
          if (!args.appId && !args.executable && !args.displayName) {
            return missingJsonReply(
              "device",
              "{\"operation\":\"open_app\",\"appId\":\"notepad\"}"
            );
          }
          const response = submitDeviceOpenApp(toToolContext(ctx), {
            appId: args.appId,
            executable: args.executable,
            displayName: args.displayName,
            arguments: args.arguments,
            waitForWindow: args.waitForWindow
          });
          return toCommandReply(formatJobReply(response));
        }
        case "screenshot": {
          if (!args.outputName) {
            return missingJsonReply(
              "device",
              "{\"operation\":\"screenshot\",\"target\":\"desktop\",\"outputName\":\"desktop.png\"}"
            );
          }
          const response = submitDeviceScreenshot(toToolContext(ctx), {
            target: args.target,
            windowId: args.windowId,
            displayId: args.displayId,
            region: args.region,
            format: args.format,
            outputName: args.outputName
          });
          return toCommandReply(formatJobReply(response));
        }
        case "click": {
          if (typeof args.x !== "number" || typeof args.y !== "number") {
            return missingJsonReply(
              "device",
              "{\"operation\":\"click\",\"x\":240,\"y\":180,\"coordinateSpace\":\"screen\"}"
            );
          }
          const response = submitDeviceClick(toToolContext(ctx), {
            x: args.x,
            y: args.y,
            coordinateSpace: args.coordinateSpace,
            windowId: args.windowId,
            button: args.button,
            clickCount: args.clickCount
          });
          return toCommandReply(formatJobReply(response));
        }
        case "type": {
          if (!args.text) {
            return missingJsonReply(
              "device",
              "{\"operation\":\"type\",\"text\":\"Hello world\",\"mode\":\"insert\"}"
            );
          }
          const response = submitDeviceType(toToolContext(ctx), {
            text: args.text,
            mode: args.mode,
            submit: args.submit,
            windowId: args.windowId
          });
          return toCommandReply(formatJobReply(response));
        }
        case "hotkey": {
          if (!args.keys?.length) {
            return missingJsonReply(
              "device",
              "{\"operation\":\"hotkey\",\"keys\":[\"ctrl\",\"shift\",\"s\"]}"
            );
          }
          const response = submitDeviceHotkey(toToolContext(ctx), {
            keys: args.keys,
            windowId: args.windowId
          });
          return toCommandReply(formatJobReply(response));
        }
        default:
          return toCommandReply(
            `Unsupported /device operation: ${String(args.operation)}`,
            true,
          );
      }
    }
  };
}

export function createWindowsCommand() {
  return {
    name: "windows",
    description: "List or focus desktop windows with deterministic JSON arguments.",
    acceptsArgs: true,
    handler: (ctx: PluginCommandContext) => {
      const args = parseJsonArgs<WindowsCommandArgs>(ctx);
      if (!args) {
        return invalidJsonReply("windows");
      }

      if (args.operation === "list") {
        const response = submitDeviceListWindows(toToolContext(ctx), {
          includeMinimized: args.includeMinimized,
          titleContains: args.titleContains,
          appId: args.appId
        });
        return toCommandReply(formatJobReply(response));
      }

      if (!args.windowId && !args.titleContains && !args.appId) {
        return missingJsonReply(
          "windows",
          "{\"operation\":\"focus\",\"titleContains\":\"Notepad\"}"
        );
      }

      const response = submitDeviceFocusWindow(toToolContext(ctx), {
        windowId: args.windowId,
        titleContains: args.titleContains,
        appId: args.appId,
        strictMatch: args.strictMatch
      });
      return toCommandReply(formatJobReply(response));
    }
  };
}

export function createClipboardCommand() {
  return {
    name: "clipboard",
    description: "Read or write the device clipboard with deterministic JSON arguments.",
    acceptsArgs: true,
    handler: (ctx: PluginCommandContext) => {
      const args = parseJsonArgs<ClipboardCommandArgs>(ctx);
      if (!args) {
        return invalidJsonReply("clipboard");
      }

      if (args.operation === "get") {
        const response = submitDeviceClipboardGet(toToolContext(ctx), {
          format: args.format
        });
        return toCommandReply(formatJobReply(response));
      }

      if (!args.text && !args.artifactIds?.length) {
        return missingJsonReply(
          "clipboard",
          "{\"operation\":\"set\",\"text\":\"Copied from Jarvis\"}"
        );
      }

      const response = submitDeviceClipboardSet(toToolContext(ctx), {
        text: args.text,
        artifactIds: args.artifactIds,
        mode: args.mode
      });
      return toCommandReply(formatJobReply(response));
    }
  };
}

export function createNotifyCommand() {
  return {
    name: "notify",
    description: "Send a local desktop notification with deterministic JSON arguments.",
    acceptsArgs: true,
    handler: (ctx: PluginCommandContext) => {
      const args = parseJsonArgs<DeviceNotifyParams>(ctx);
      if (!args) {
        return invalidJsonReply("notify");
      }
      if (!args.title || !args.body) {
        return missingJsonReply(
          "notify",
          "{\"title\":\"Jarvis\",\"body\":\"Task finished\",\"urgency\":\"normal\"}"
        );
      }
      const response = submitDeviceNotify(toToolContext(ctx), args);
      return toCommandReply(formatJobReply(response));
    }
  };
}

export const jarvisDeviceToolNames = [...DEVICE_TOOL_NAMES];
export const jarvisDeviceCommandNames = [...DEVICE_COMMAND_NAMES];

export default definePluginEntry({
  id: "jarvis-device",
  name: "Jarvis Device",
  description: "Desktop and device job broker for host observation and control",
  register(api) {
    api.registerTool((ctx) => createDeviceTools(ctx));
    api.registerCommand(createDeviceCommand());
    api.registerCommand(createWindowsCommand());
    api.registerCommand(createClipboardCommand());
    api.registerCommand(createNotifyCommand());
  }
});
