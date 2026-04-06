import { Type } from "@sinclair/typebox";
import { createBrowserPluginService } from "openclaw/plugin-sdk/browser";
import {
  definePluginEntry,
  type AnyAgentTool,
  type OpenClawPluginToolContext,
  type PluginCommandContext
} from "openclaw/plugin-sdk/plugin-entry";
import {
  getJarvisState,
  safeJsonParse,
  toCommandReply,
  toToolResult,
  type ToolResponse
} from "@jarvis/shared";

type BrowserRunTaskParams = {
  targetUrl: string;
  task: string;
  outputName?: string;
  allowDownloads?: boolean;
  waitForIdle?: boolean;
  approvalId?: string;
};

type BrowserExtractParams = {
  url: string;
  selector?: string;
  format: "json" | "markdown" | "text" | "html";
  outputName: string;
};

type BrowserCaptureParams = {
  url: string;
  outputName: string;
  fullPage?: boolean;
  format?: "png" | "pdf";
};

type BrowserDownloadParams = {
  url: string;
  outputName: string;
  fileName?: string;
};

type BrowserCommandArgs =
  | ({ operation: "run_task" } & BrowserRunTaskParams)
  | ({ operation: "extract" } & BrowserExtractParams)
  | ({ operation: "capture" } & BrowserCaptureParams)
  | ({ operation: "download" } & BrowserDownloadParams);

function asLiteralUnion<const Values extends readonly [string, ...string[]]>(
  values: Values,
) {
  return Type.Union(values.map((value) => Type.Literal(value)) as [any, any, ...any[]]);
}

const browserExtractFormatSchema = asLiteralUnion(["json", "markdown", "text", "html"] as const);
const browserCaptureFormatSchema = asLiteralUnion(["png", "pdf"] as const);

function createBrowserTool(
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

function submitBrowserJob(
  ctx: OpenClawPluginToolContext | undefined,
  type: "browser.run_task" | "browser.extract" | "browser.capture" | "browser.download",
  input: Record<string, unknown>,
  artifactsIn: { artifact_id: string }[] = [],
  approvalId?: string,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type,
    input,
    artifactsIn,
    approvalId,
    capabilityRoute: "browser"
  });
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

export function createBrowserTools(ctx: OpenClawPluginToolContext): AnyAgentTool[] {
  return [
    createBrowserTool(
      ctx,
      "browser_run_task",
      "Browser Run Task",
      "Queue a browser automation task against the managed OpenClaw browser profile.",
      Type.Object({
        targetUrl: Type.String({ minLength: 1 }),
        task: Type.String({ minLength: 1 }),
        outputName: Type.Optional(Type.String({ minLength: 1 })),
        allowDownloads: Type.Optional(Type.Boolean()),
        waitForIdle: Type.Optional(Type.Boolean()),
        approvalId: Type.Optional(Type.String({ minLength: 1 }))
      }),
      (toolCtx, params: BrowserRunTaskParams) =>
        submitBrowserJob(
          toolCtx,
          "browser.run_task",
          {
            target_url: params.targetUrl,
            task: params.task,
            output_name: params.outputName,
            allow_downloads: params.allowDownloads ?? false,
            wait_for_idle: params.waitForIdle ?? true
          },
          [],
          params.approvalId
        )
    ),
    createBrowserTool(
      ctx,
      "browser_extract",
      "Browser Extract",
      "Extract structured data from a page or selector in the managed browser.",
      Type.Object({
        url: Type.String({ minLength: 1 }),
        selector: Type.Optional(Type.String({ minLength: 1 })),
        format: browserExtractFormatSchema,
        outputName: Type.String({ minLength: 1 })
      }),
      (toolCtx, params: BrowserExtractParams) =>
        submitBrowserJob(
          toolCtx,
          "browser.extract",
          {
            url: params.url,
            selector: params.selector,
            format: params.format,
            output_name: params.outputName
          }
        )
    ),
    createBrowserTool(
      ctx,
      "browser_capture",
      "Browser Capture",
      "Capture a browser page or screenshot artifact from the managed browser.",
      Type.Object({
        url: Type.String({ minLength: 1 }),
        outputName: Type.String({ minLength: 1 }),
        fullPage: Type.Optional(Type.Boolean()),
        format: Type.Optional(browserCaptureFormatSchema)
      }),
      (toolCtx, params: BrowserCaptureParams) =>
        submitBrowserJob(
          toolCtx,
          "browser.capture",
          {
            url: params.url,
            output_name: params.outputName,
            full_page: params.fullPage ?? true,
            format: params.format ?? "png"
          }
        )
    ),
    createBrowserTool(
      ctx,
      "browser_download",
      "Browser Download",
      "Download a file or asset from a browser session into a managed artifact.",
      Type.Object({
        url: Type.String({ minLength: 1 }),
        outputName: Type.String({ minLength: 1 }),
        fileName: Type.Optional(Type.String({ minLength: 1 }))
      }),
      (toolCtx, params: BrowserDownloadParams) =>
        submitBrowserJob(
          toolCtx,
          "browser.download",
          {
            url: params.url,
            output_name: params.outputName,
            file_name: params.fileName
          }
        )
    )
  ];
}

export function createBrowserCommand() {
  return {
    name: "browser",
    description: "Submit a deterministic browser job spec from JSON arguments.",
    acceptsArgs: true,
    handler: (ctx: PluginCommandContext) => {
      const args = parseJsonArgs<BrowserCommandArgs>(ctx);
      if (!args) {
        return invalidJsonReply("browser");
      }

      switch (args.operation) {
        case "run_task": {
          if (!args.targetUrl || !args.task) {
            return missingJsonReply(
              "browser",
              '{"operation":"run_task","targetUrl":"https://example.com","task":"collect the latest heading"}'
            );
          }
          const response = submitBrowserJob(
            toToolContext(ctx),
            "browser.run_task",
            {
              target_url: args.targetUrl,
              task: args.task,
              output_name: args.outputName,
              allow_downloads: args.allowDownloads ?? false,
              wait_for_idle: args.waitForIdle ?? true
            },
            [],
            args.approvalId
          );
          return toCommandReply(formatJobReply(response));
        }
        case "extract": {
          if (!args.url || !args.format || !args.outputName) {
            return missingJsonReply(
              "browser",
              '{"operation":"extract","url":"https://example.com","format":"json","outputName":"extract.json"}'
            );
          }
          const response = submitBrowserJob(toToolContext(ctx), "browser.extract", {
            url: args.url,
            selector: args.selector,
            format: args.format,
            output_name: args.outputName
          });
          return toCommandReply(formatJobReply(response));
        }
        case "capture": {
          if (!args.url || !args.outputName) {
            return missingJsonReply(
              "browser",
              '{"operation":"capture","url":"https://example.com","outputName":"page.png"}'
            );
          }
          const response = submitBrowserJob(toToolContext(ctx), "browser.capture", {
            url: args.url,
            output_name: args.outputName,
            full_page: args.fullPage ?? true,
            format: args.format ?? "png"
          });
          return toCommandReply(formatJobReply(response));
        }
        case "download": {
          if (!args.url || !args.outputName) {
            return missingJsonReply(
              "browser",
              '{"operation":"download","url":"https://example.com/file.csv","outputName":"file.csv"}'
            );
          }
          const response = submitBrowserJob(toToolContext(ctx), "browser.download", {
            url: args.url,
            output_name: args.outputName,
            file_name: args.fileName
          });
          return toCommandReply(formatJobReply(response));
        }
        default:
          return toCommandReply(
            `Unsupported /browser operation: ${String((args as { operation?: string }).operation)}`,
            true,
          );
      }
    }
  };
}

export const browserToolNames = [
  "browser_run_task",
  "browser_extract",
  "browser_capture",
  "browser_download"
] as const;

export const browserCommandNames = ["/browser"] as const;

export default definePluginEntry({
  id: "jarvis-browser",
  name: "Jarvis Browser",
  description: "Browser job broker for the managed OpenClaw browser profile",
  register(api) {
    api.registerService(createBrowserPluginService());
    api.registerTool((ctx) => createBrowserTools(ctx));
    api.registerCommand(createBrowserCommand());
  }
});
