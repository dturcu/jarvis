import { Type } from "@sinclair/typebox";
import type {
  AnyAgentTool,
  OpenClawPluginToolContext,
  PluginCommandContext
} from "openclaw/plugin-sdk/plugin-entry";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import {
  BUILT_IN_TOOLS_REQUIRING_HOOK_APPROVAL,
  CORE_COMMAND_NAMES,
  CORE_TOOL_NAMES,
  CONTRACT_VERSION,
  JOB_TYPE_NAMES,
  createToolResponse,
  getJarvisState,
  toCommandReply,
  toToolResult,
  type JarvisJobType
} from "@jarvis/shared";

const JOB_TYPE_LITERALS = JOB_TYPE_NAMES.map((jobType) =>
  Type.Literal(jobType),
) as [ReturnType<typeof Type.Literal>, ...ReturnType<typeof Type.Literal>[]];

function createJarvisPlanTool(_ctx: OpenClawPluginToolContext): AnyAgentTool {
  return {
    name: "jarvis_plan",
    label: "Jarvis Plan",
    description: "Summarize the recommended Jarvis execution path for a goal.",
    parameters: Type.Object({
      goal: Type.String({ minLength: 1 }),
      preferredCapabilities: Type.Optional(Type.Array(Type.String())),
      mustUseApprovals: Type.Optional(Type.Boolean())
    }),
    execute: async (_toolCallId, params) => {
      const response = createToolResponse({
        status: "completed",
        summary: `Planned a Jarvis workflow for: ${params.goal}`,
        structured_output: {
          contract_version: CONTRACT_VERSION,
          recommended_sequence: [
            "@jarvis/core",
            "@jarvis/jobs",
            "@jarvis/dispatch",
            "@jarvis/office"
          ],
          preferred_capabilities: params.preferredCapabilities ?? [],
          approvals_required: Boolean(params.mustUseApprovals)
        }
      });
      return toToolResult(response);
    }
  };
}

function createJarvisRunJobTool(ctx: OpenClawPluginToolContext): AnyAgentTool {
  return {
    name: "jarvis_run_job",
    label: "Jarvis Run Job",
    description: "Queue a typed Jarvis worker job against the shared broker.",
    parameters: Type.Object({
      type: Type.Union(JOB_TYPE_LITERALS),
      input: Type.Record(Type.String(), Type.Unknown()),
      artifactIds: Type.Optional(Type.Array(Type.String())),
      priority: Type.Optional(
        Type.Union([
          Type.Literal("low"),
          Type.Literal("normal"),
          Type.Literal("high"),
          Type.Literal("urgent")
        ]),
      ),
      approvalId: Type.Optional(Type.String())
    }),
    execute: async (_toolCallId, params) => {
      const response = getJarvisState().submitJob({
        ctx,
        type: params.type as JarvisJobType,
        input: params.input,
        artifactsIn: (params.artifactIds ?? []).map((artifactId: string) => ({
          artifact_id: artifactId
        })),
        priority: params.priority,
        approvalId: params.approvalId
      });
      return toToolResult(response);
    }
  };
}

function createJarvisGetJobTool(): AnyAgentTool {
  return {
    name: "jarvis_get_job",
    label: "Jarvis Get Job",
    description: "Return a Jarvis job summary and current state.",
    parameters: Type.Object({
      jobId: Type.String({ format: "uuid" })
    }),
    execute: async (_toolCallId, params) =>
      toToolResult(getJarvisState().getJob(params.jobId))
  };
}

function createJarvisListArtifactsTool(): AnyAgentTool {
  return {
    name: "jarvis_list_artifacts",
    label: "Jarvis List Artifacts",
    description: "List artifacts for a job or across all tracked jobs.",
    parameters: Type.Object({
      jobId: Type.Optional(Type.String({ format: "uuid" }))
    }),
    execute: async (_toolCallId, params) =>
      toToolResult(getJarvisState().listArtifacts(params.jobId))
  };
}

function createJarvisRequestApprovalTool(): AnyAgentTool {
  return {
    name: "jarvis_request_approval",
    label: "Jarvis Request Approval",
    description: "Create a Jarvis-managed approval request.",
    parameters: Type.Object({
      title: Type.String({ minLength: 1 }),
      description: Type.String({ minLength: 1 }),
      severity: Type.Optional(
        Type.Union([
          Type.Literal("info"),
          Type.Literal("warning"),
          Type.Literal("critical")
        ]),
      ),
      scopes: Type.Optional(Type.Array(Type.String()))
    }),
    execute: async (_toolCallId, params) => {
      const approval = getJarvisState().requestApproval({
        title: params.title,
        description: params.description,
        severity: params.severity,
        scopes: params.scopes
      });
      return toToolResult(
        createToolResponse({
          status: "awaiting_approval",
          summary: `Created approval request ${approval.approval_id}.`,
          approval_id: approval.approval_id,
          structured_output: approval
        }),
      );
    }
  };
}

export function createJarvisCoreTools(
  ctx: OpenClawPluginToolContext,
): AnyAgentTool[] {
  return [
    createJarvisPlanTool(ctx),
    createJarvisRunJobTool(ctx),
    createJarvisGetJobTool(),
    createJarvisListArtifactsTool(),
    createJarvisRequestApprovalTool()
  ];
}

export function createApprovalCommand() {
  return {
    name: "approve",
    description: "Resolve a Jarvis-managed approval request.",
    acceptsArgs: true,
    handler: (ctx: PluginCommandContext) => {
      const [approvalId, action] = (ctx.args ?? "").trim().split(/\s+/, 2);
      if (!approvalId || !action) {
        return toCommandReply(
          "Usage: /approve <approval-id> <approved|rejected|expired|cancelled>",
          true,
        );
      }

      const normalized =
        action === "allow-once" || action === "allow-always"
          ? "approved"
          : action;

      if (
        normalized !== "approved" &&
        normalized !== "rejected" &&
        normalized !== "expired" &&
        normalized !== "cancelled"
      ) {
        return toCommandReply(`Unsupported approval action: ${action}`, true);
      }

      const resolved = getJarvisState().resolveApproval(approvalId, normalized);
      if (!resolved) {
        return toCommandReply(`Unknown approval id: ${approvalId}`, true);
      }

      return toCommandReply(`Approval ${approvalId} marked ${resolved.state}.`);
    }
  };
}

export function createJarvisApprovalHook() {
  return (event: { toolName: string }) => {
    if (!BUILT_IN_TOOLS_REQUIRING_HOOK_APPROVAL.has(event.toolName)) {
      return;
    }

    return {
      requireApproval: {
        title: `Approve ${event.toolName}`,
        description: `Jarvis requires operator approval before using ${event.toolName}.`,
        severity: event.toolName === "exec" ? ("critical" as const) : ("warning" as const),
        timeoutMs: 300000,
        timeoutBehavior: "deny" as const
      }
    };
  };
}

export const jarvisCoreCommandNames = [...CORE_COMMAND_NAMES];
export const jarvisCoreToolNames = [...CORE_TOOL_NAMES];

export default definePluginEntry({
  id: "jarvis-core",
  name: "Jarvis Core",
  description: "Jarvis approvals, orchestration, and policy plugin",
  register(api) {
    api.registerTool((ctx) => createJarvisCoreTools(ctx));
    api.registerCommand(createApprovalCommand());
    api.on("before_tool_call", createJarvisApprovalHook(), {
      priority: 0
    });
  }
});
