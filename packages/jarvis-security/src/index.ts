import { Type } from "@sinclair/typebox";
import {
  definePluginEntry,
  type AnyAgentTool,
  type OpenClawPluginToolContext,
  type PluginCommandContext
} from "openclaw/plugin-sdk/plugin-entry";
import {
  SECURITY_TOOL_NAMES,
  SECURITY_COMMAND_NAMES,
  getJarvisState,
  safeJsonParse,
  submitSecurityScanProcesses,
  submitSecurityWhitelistUpdate,
  submitSecurityNetworkAudit,
  submitSecurityFileIntegrityCheck,
  submitSecurityFileIntegrityBaseline,
  submitSecurityFirewallRule,
  submitSecurityLockdown,
  toCommandReply,
  toToolResult,
  type SecurityScanProcessesParams,
  type SecurityWhitelistUpdateParams,
  type SecurityNetworkAuditParams,
  type SecurityFileIntegrityCheckParams,
  type SecurityFileIntegrityBaselineParams,
  type SecurityFirewallRuleParams,
  type SecurityLockdownParams,
  type ToolResponse
} from "@jarvis/shared";

function asLiteralUnion<const Values extends readonly [string, ...string[]]>(
  values: Values,
) {
  return Type.Union(values.map((value) => Type.Literal(value)) as [any, any, ...any[]]);
}

const actionAddRemoveSchema = asLiteralUnion(["add", "remove"] as const);
const actionFirewallSchema = asLiteralUnion(["add", "remove", "list"] as const);
const directionSchema = asLiteralUnion(["inbound", "outbound"] as const);
const protocolSchema = asLiteralUnion(["tcp", "udp"] as const);
const lockdownLevelSchema = asLiteralUnion(["standard", "maximum"] as const);

function createSecurityTool(
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

export function createSecurityTools(ctx: OpenClawPluginToolContext): AnyAgentTool[] {
  return [
    createSecurityTool(
      ctx,
      "security_scan_processes",
      "Security Scan Processes",
      "Scan running processes against the security whitelist and flag suspicious activity.",
      Type.Object({
        whitelist_only: Type.Optional(Type.Boolean({
          description: "If true, only return non-whitelisted processes."
        }))
      }),
      (toolCtx, params: { whitelist_only?: boolean }) =>
        submitSecurityScanProcesses(toolCtx, { whitelistOnly: params.whitelist_only })
    ),
    createSecurityTool(
      ctx,
      "security_whitelist_update",
      "Security Whitelist Update",
      "Add or remove process names or hashes from the security whitelist.",
      Type.Object({
        action: actionAddRemoveSchema,
        process_names: Type.Optional(Type.Array(Type.String({ minLength: 1 }), {
          description: "Process names to add or remove."
        })),
        process_hashes: Type.Optional(Type.Array(Type.String({ minLength: 1 }), {
          description: "Process SHA-256 hashes to add or remove."
        }))
      }),
      (toolCtx, params: { action: "add" | "remove"; process_names?: string[]; process_hashes?: string[] }) =>
        submitSecurityWhitelistUpdate(toolCtx, {
          action: params.action,
          processNames: params.process_names,
          processHashes: params.process_hashes
        })
    ),
    createSecurityTool(
      ctx,
      "security_network_audit",
      "Security Network Audit",
      "Audit active network connections and flag suspicious connections to known malicious ports or states.",
      Type.Object({
        include_listening: Type.Optional(Type.Boolean({ description: "Include listening ports." })),
        include_established: Type.Optional(Type.Boolean({ description: "Include established connections." })),
        suspicious_only: Type.Optional(Type.Boolean({ description: "Return only suspicious connections." }))
      }),
      (toolCtx, params: { include_listening?: boolean; include_established?: boolean; suspicious_only?: boolean }) =>
        submitSecurityNetworkAudit(toolCtx, {
          includeListening: params.include_listening,
          includeEstablished: params.include_established,
          suspiciousOnly: params.suspicious_only
        })
    ),
    createSecurityTool(
      ctx,
      "security_file_integrity_check",
      "Security File Integrity Check",
      "Compute SHA-256 hashes for a set of files and compare against a previously created baseline.",
      Type.Object({
        paths: Type.Array(Type.String({ minLength: 1 }), {
          description: "File paths to hash and check.",
          minItems: 1
        }),
        baseline_id: Type.Optional(Type.String({
          minLength: 1,
          description: "ID of a previously created baseline to compare against."
        }))
      }),
      (toolCtx, params: { paths: string[]; baseline_id?: string }) =>
        submitSecurityFileIntegrityCheck(toolCtx, {
          paths: params.paths,
          baselineId: params.baseline_id
        })
    ),
    createSecurityTool(
      ctx,
      "security_file_integrity_baseline",
      "Security File Integrity Baseline",
      "Create a file integrity baseline by recording current SHA-256 hashes for a set of file paths.",
      Type.Object({
        paths: Type.Array(Type.String({ minLength: 1 }), {
          description: "File paths to include in the baseline.",
          minItems: 1
        }),
        label: Type.Optional(Type.String({
          minLength: 1,
          description: "Human-readable label for this baseline."
        }))
      }),
      (toolCtx, params: { paths: string[]; label?: string }) =>
        submitSecurityFileIntegrityBaseline(toolCtx, {
          paths: params.paths,
          label: params.label
        })
    ),
    createSecurityTool(
      ctx,
      "security_firewall_rule",
      "Security Firewall Rule",
      "Add, remove, or list Windows Firewall rules to control inbound and outbound traffic.",
      Type.Object({
        action: actionFirewallSchema,
        direction: Type.Optional(directionSchema),
        port: Type.Optional(Type.Integer({ minimum: 1, maximum: 65535, description: "Port number." })),
        protocol: Type.Optional(protocolSchema),
        program: Type.Optional(Type.String({ minLength: 1, description: "Program path to restrict." })),
        rule_name: Type.Optional(Type.String({ minLength: 1, description: "Rule name for add/remove." }))
      }),
      (toolCtx, params: { action: "add" | "remove" | "list"; direction?: "inbound" | "outbound"; port?: number; protocol?: "tcp" | "udp"; program?: string; rule_name?: string }) =>
        submitSecurityFirewallRule(toolCtx, {
          action: params.action,
          direction: params.direction,
          port: params.port,
          protocol: params.protocol,
          program: params.program,
          ruleName: params.rule_name
        })
    ),
    createSecurityTool(
      ctx,
      "security_lockdown",
      "Security Lockdown",
      "Activate security lockdown mode: kill non-whitelisted processes, block outbound traffic, and lock the screen.",
      Type.Object({
        level: lockdownLevelSchema,
        kill_non_whitelisted: Type.Optional(Type.Boolean({ description: "Kill non-whitelisted processes." })),
        block_outbound: Type.Optional(Type.Boolean({ description: "Block all outbound connections." })),
        lock_screen: Type.Optional(Type.Boolean({ description: "Lock the workstation screen." }))
      }),
      (toolCtx, params: { level: "standard" | "maximum"; kill_non_whitelisted?: boolean; block_outbound?: boolean; lock_screen?: boolean }) =>
        submitSecurityLockdown(toolCtx, {
          level: params.level,
          killNonWhitelisted: params.kill_non_whitelisted,
          blockOutbound: params.block_outbound,
          lockScreen: params.lock_screen
        })
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

function invalidJsonReply(commandName: string) {
  return toCommandReply(`Invalid JSON arguments for /${commandName}.`, true);
}

export function createSecurityCommand() {
  return {
    name: "security",
    description: "Run security scans: scan_processes, network_audit, file_integrity_check, file_integrity_baseline, whitelist_update.",
    acceptsArgs: true,
    handler: (ctx: PluginCommandContext) => {
      const args = parseJsonArgs<{
        operation: "scan_processes" | "network_audit" | "whitelist_update" | "file_integrity_check" | "file_integrity_baseline";
        whitelistOnly?: boolean;
        action?: "add" | "remove";
        processNames?: string[];
        processHashes?: string[];
        includeListening?: boolean;
        includeEstablished?: boolean;
        suspiciousOnly?: boolean;
        paths?: string[];
        baselineId?: string;
        label?: string;
      }>(ctx);

      if (!args) {
        return invalidJsonReply("security");
      }

      const toolCtx = toToolContext(ctx);

      switch (args.operation) {
        case "scan_processes": {
          const response = submitSecurityScanProcesses(toolCtx, { whitelistOnly: args.whitelistOnly });
          return toCommandReply(formatJobReply(response));
        }
        case "network_audit": {
          const response = submitSecurityNetworkAudit(toolCtx, {
            includeListening: args.includeListening,
            includeEstablished: args.includeEstablished,
            suspiciousOnly: args.suspiciousOnly
          });
          return toCommandReply(formatJobReply(response));
        }
        case "whitelist_update": {
          if (!args.action) {
            return toCommandReply("Missing 'action' (add|remove) for whitelist_update.", true);
          }
          const response = submitSecurityWhitelistUpdate(toolCtx, {
            action: args.action,
            processNames: args.processNames,
            processHashes: args.processHashes
          });
          return toCommandReply(formatJobReply(response));
        }
        case "file_integrity_check": {
          if (!args.paths || args.paths.length === 0) {
            return toCommandReply("Missing 'paths' for file_integrity_check.", true);
          }
          const response = submitSecurityFileIntegrityCheck(toolCtx, {
            paths: args.paths,
            baselineId: args.baselineId
          });
          return toCommandReply(formatJobReply(response));
        }
        case "file_integrity_baseline": {
          if (!args.paths || args.paths.length === 0) {
            return toCommandReply("Missing 'paths' for file_integrity_baseline.", true);
          }
          const response = submitSecurityFileIntegrityBaseline(toolCtx, {
            paths: args.paths,
            label: args.label
          });
          return toCommandReply(formatJobReply(response));
        }
        default:
          return toCommandReply(
            `Unsupported /security operation. Valid: scan_processes, network_audit, whitelist_update, file_integrity_check, file_integrity_baseline.`,
            true
          );
      }
    }
  };
}

export function createLockdownCommand() {
  return {
    name: "lockdown",
    description: "Activate security lockdown mode to kill suspicious processes, block outbound, and lock screen.",
    acceptsArgs: true,
    handler: (ctx: PluginCommandContext) => {
      const args = parseJsonArgs<{
        level?: "standard" | "maximum";
        killNonWhitelisted?: boolean;
        blockOutbound?: boolean;
        lockScreen?: boolean;
      }>(ctx) ?? {};

      const toolCtx = toToolContext(ctx);
      const response = submitSecurityLockdown(toolCtx, {
        level: args.level ?? "standard",
        killNonWhitelisted: args.killNonWhitelisted,
        blockOutbound: args.blockOutbound,
        lockScreen: args.lockScreen
      });
      return toCommandReply(formatJobReply(response));
    }
  };
}

export function createAuditCommand() {
  return {
    name: "audit",
    description: "Audit network connections for suspicious activity.",
    acceptsArgs: true,
    handler: (ctx: PluginCommandContext) => {
      const args = parseJsonArgs<{
        includeListening?: boolean;
        includeEstablished?: boolean;
        suspiciousOnly?: boolean;
      }>(ctx) ?? {};

      const toolCtx = toToolContext(ctx);
      const response = submitSecurityNetworkAudit(toolCtx, {
        includeListening: args.includeListening,
        includeEstablished: args.includeEstablished,
        suspiciousOnly: args.suspiciousOnly
      });
      return toCommandReply(formatJobReply(response));
    }
  };
}

export const jarvisSecurityToolNames = [...SECURITY_TOOL_NAMES];
export const jarvisSecurityCommandNames = [...SECURITY_COMMAND_NAMES];

export default definePluginEntry({
  id: "jarvis-security",
  name: "Jarvis Security",
  description: "Security and defense plugin for process monitoring, file integrity, network audit, firewall management, and lockdown mode",
  register(api) {
    api.registerTool((ctx) => createSecurityTools(ctx));
    api.registerCommand(createSecurityCommand());
    api.registerCommand(createLockdownCommand());
    api.registerCommand(createAuditCommand());
  }
});
