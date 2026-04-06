import type { OpenClawPluginToolContext } from "openclaw/plugin-sdk/plugin-entry";
import { getJarvisState } from "./state.js";
import type { ToolResponse } from "./types.js";

export type SecurityScanProcessesParams = {
  whitelistOnly?: boolean;
};

export type SecurityWhitelistUpdateParams = {
  action: "add" | "remove";
  processNames?: string[];
  processHashes?: string[];
};

export type SecurityNetworkAuditParams = {
  includeListening?: boolean;
  includeEstablished?: boolean;
  suspiciousOnly?: boolean;
};

export type SecurityFileIntegrityCheckParams = {
  paths: string[];
  baselineId?: string;
};

export type SecurityFileIntegrityBaselineParams = {
  paths: string[];
  label?: string;
};

export type SecurityFirewallRuleParams = {
  action: "add" | "remove" | "list";
  direction?: "inbound" | "outbound";
  port?: number;
  protocol?: "tcp" | "udp";
  program?: string;
  ruleName?: string;
};

export type SecurityLockdownParams = {
  level: "standard" | "maximum";
  killNonWhitelisted?: boolean;
  blockOutbound?: boolean;
  lockScreen?: boolean;
};

export function submitSecurityScanProcesses(
  ctx: OpenClawPluginToolContext | undefined,
  params: SecurityScanProcessesParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "security.scan_processes",
    input: {
      whitelist_only: params.whitelistOnly ?? false
    }
  });
}

export function submitSecurityWhitelistUpdate(
  ctx: OpenClawPluginToolContext | undefined,
  params: SecurityWhitelistUpdateParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "security.whitelist_update",
    input: {
      action: params.action,
      process_names: params.processNames,
      process_hashes: params.processHashes
    }
  });
}

export function submitSecurityNetworkAudit(
  ctx: OpenClawPluginToolContext | undefined,
  params: SecurityNetworkAuditParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "security.network_audit",
    input: {
      include_listening: params.includeListening ?? true,
      include_established: params.includeEstablished ?? true,
      suspicious_only: params.suspiciousOnly ?? false
    }
  });
}

export function submitSecurityFileIntegrityCheck(
  ctx: OpenClawPluginToolContext | undefined,
  params: SecurityFileIntegrityCheckParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "security.file_integrity_check",
    input: {
      paths: params.paths,
      baseline_id: params.baselineId
    }
  });
}

export function submitSecurityFileIntegrityBaseline(
  ctx: OpenClawPluginToolContext | undefined,
  params: SecurityFileIntegrityBaselineParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "security.file_integrity_baseline",
    input: {
      paths: params.paths,
      label: params.label
    }
  });
}

export function submitSecurityFirewallRule(
  ctx: OpenClawPluginToolContext | undefined,
  params: SecurityFirewallRuleParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "security.firewall_rule",
    input: {
      action: params.action,
      direction: params.direction,
      port: params.port,
      protocol: params.protocol,
      program: params.program,
      rule_name: params.ruleName
    }
  });
}

export function submitSecurityLockdown(
  ctx: OpenClawPluginToolContext | undefined,
  params: SecurityLockdownParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "security.lockdown",
    input: {
      level: params.level,
      kill_non_whitelisted: params.killNonWhitelisted ?? false,
      block_outbound: params.blockOutbound ?? false,
      lock_screen: params.lockScreen ?? true
    }
  });
}
