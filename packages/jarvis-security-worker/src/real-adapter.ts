import { randomUUID } from "node:crypto";
import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import type { ExecutionOutcome, SecurityAdapter } from "./adapter.js";
import { SecurityWorkerError } from "./adapter.js";
import type {
  SecurityScanProcessesInput,
  SecurityScanProcessesOutput,
  ProcessScanEntry,
  SecurityWhitelistUpdateInput,
  SecurityWhitelistUpdateOutput,
  SecurityNetworkAuditInput,
  SecurityNetworkAuditOutput,
  NetworkConnectionEntry,
  SecurityFileIntegrityCheckInput,
  SecurityFileIntegrityCheckOutput,
  SecurityFileIntegrityBaselineInput,
  SecurityFileIntegrityBaselineOutput,
  SecurityFirewallRuleInput,
  SecurityFirewallRuleOutput,
  SecurityLockdownInput,
  SecurityLockdownOutput,
  FileHashEntry,
} from "./types.js";
import { scanProcesses, getProcessHash } from "./process-monitor.js";
import type { PowerShellRunner } from "./process-monitor.js";
import { auditConnections, isSuspiciousConnection } from "./network-audit.js";
import { computeFileHashes, compareWithBaseline } from "./file-integrity.js";
import type { FileHash } from "./file-integrity.js";
import { addFirewallRule, removeFirewallRule, listFirewallRules } from "./firewall.js";
import type { CommandRunner } from "./firewall.js";
import { executeLockdown } from "./lockdown.js";
import type { LockdownRunner } from "./lockdown.js";

const execPromise = promisify(execCb);

export type RealSecurityAdapterOptions = {
  /** Initial process whitelist (names). Defaults to common safe Windows processes. */
  initialWhitelist?: string[];
};

/**
 * Creates a PowerShell runner that executes scripts via `powershell -NoProfile -NonInteractive -Command`.
 */
function createPowerShellRunner(): PowerShellRunner {
  return {
    async run(script: string): Promise<string> {
      const { stdout } = await execPromise(
        `powershell -NoProfile -NonInteractive -Command "${script.replace(/"/g, '\\"')}"`,
        { maxBuffer: 10 * 1024 * 1024 },
      );
      return stdout;
    },
  };
}

/**
 * Creates a command runner that delegates to child_process.exec.
 */
function createCommandRunner(): CommandRunner {
  return {
    async exec(cmd: string): Promise<{ stdout: string; stderr: string }> {
      const { stdout, stderr } = await execPromise(cmd, { maxBuffer: 10 * 1024 * 1024 });
      return { stdout, stderr };
    },
  };
}

/**
 * Creates a lockdown runner that combines PowerShell process scanning with command execution.
 */
function createLockdownRunner(psRunner: PowerShellRunner, cmdRunner: CommandRunner): LockdownRunner {
  return {
    async exec(cmd: string): Promise<{ stdout: string; stderr: string }> {
      return cmdRunner.exec(cmd);
    },
    async killProcess(pid: number): Promise<boolean> {
      try {
        await cmdRunner.exec(`taskkill /F /PID ${pid}`);
        return true;
      } catch {
        return false;
      }
    },
    async listNonWhitelistedPids(whitelist: Set<string>): Promise<number[]> {
      const processes = await scanProcesses(psRunner);
      return processes
        .filter((p) => !whitelist.has(p.name) && !whitelist.has(`${p.name}.exe`))
        .map((p) => p.pid);
    },
  };
}

const DEFAULT_WHITELIST = [
  "System", "System Idle Process", "svchost", "svchost.exe",
  "csrss", "csrss.exe", "wininit", "wininit.exe",
  "winlogon", "winlogon.exe", "services", "services.exe",
  "lsass", "lsass.exe", "smss", "smss.exe",
  "explorer", "explorer.exe", "dwm", "dwm.exe",
  "taskhostw", "taskhostw.exe", "RuntimeBroker", "RuntimeBroker.exe",
  "chrome", "chrome.exe", "Code", "Code.exe",
  "node", "node.exe", "conhost", "conhost.exe",
  "powershell", "powershell.exe", "cmd", "cmd.exe",
  "SearchHost", "SearchHost.exe", "StartMenuExperienceHost", "StartMenuExperienceHost.exe",
  "ShellExperienceHost", "ShellExperienceHost.exe", "sihost", "sihost.exe",
  "fontdrvhost", "fontdrvhost.exe", "WmiPrvSE", "WmiPrvSE.exe",
];

export class RealSecurityAdapter implements SecurityAdapter {
  private whitelist: Set<string>;
  private baselines: Map<string, { files: FileHash[]; label?: string; createdAt: string }> = new Map();
  private readonly psRunner: PowerShellRunner;
  private readonly cmdRunner: CommandRunner;
  private readonly lockdownRunner: LockdownRunner;

  constructor(options: RealSecurityAdapterOptions = {}) {
    this.whitelist = new Set(options.initialWhitelist ?? DEFAULT_WHITELIST);
    this.psRunner = createPowerShellRunner();
    this.cmdRunner = createCommandRunner();
    this.lockdownRunner = createLockdownRunner(this.psRunner, this.cmdRunner);
  }

  async scanProcesses(
    input: SecurityScanProcessesInput,
  ): Promise<ExecutionOutcome<SecurityScanProcessesOutput>> {
    try {
      const rawProcesses = await scanProcesses(this.psRunner);

      const processes: ProcessScanEntry[] = await Promise.all(
        rawProcesses.map(async (p) => {
          const whitelisted = this.whitelist.has(p.name) || this.whitelist.has(`${p.name}.exe`);

          // Compute hash for non-whitelisted processes that have a path
          let hash: string | undefined;
          if (!whitelisted && p.path) {
            try {
              hash = await getProcessHash(p.path);
            } catch {
              // Skip if we cannot read the executable
            }
          }

          // Determine if suspicious
          const suspicious = !whitelisted && p.cpuPercent > 10;
          const suspiciousReason = suspicious
            ? `High CPU usage (${p.cpuPercent}%) from non-whitelisted process`
            : undefined;

          // Check whitelist by hash too
          const whitelistedByHash = hash ? this.whitelist.has(`hash:${hash}`) : false;

          return {
            pid: p.pid,
            name: p.name,
            path: p.path,
            hash,
            cpu_percent: p.cpuPercent,
            memory_mb: p.memoryMb,
            user: p.user,
            whitelisted: whitelisted || whitelistedByHash,
            suspicious: suspicious && !whitelistedByHash,
            suspicious_reason: suspicious && !whitelistedByHash ? suspiciousReason : undefined,
          };
        }),
      );

      // Filter if whitelist_only — show only non-whitelisted
      const filtered = input.whitelist_only
        ? processes.filter((p) => !p.whitelisted)
        : processes;

      const suspiciousCount = filtered.filter((p) => p.suspicious).length;
      const nonWhitelistedCount = filtered.filter((p) => !p.whitelisted).length;

      return {
        summary: `Scanned ${filtered.length} process(es). ${suspiciousCount} suspicious, ${nonWhitelistedCount} non-whitelisted.`,
        structured_output: {
          scanned_at: new Date().toISOString(),
          total_count: filtered.length,
          suspicious_count: suspiciousCount,
          non_whitelisted_count: nonWhitelistedCount,
          processes: filtered,
        },
      };
    } catch (error) {
      throw new SecurityWorkerError(
        "SCAN_FAILED",
        `Process scan failed: ${error instanceof Error ? error.message : "unknown error"}`,
        true,
      );
    }
  }

  async whitelistUpdate(
    input: SecurityWhitelistUpdateInput,
  ): Promise<ExecutionOutcome<SecurityWhitelistUpdateOutput>> {
    const addedNames: string[] = [];
    const removedNames: string[] = [];
    const addedHashes: string[] = [];
    const removedHashes: string[] = [];

    if (input.process_names) {
      for (const name of input.process_names) {
        if (input.action === "add") {
          this.whitelist.add(name);
          addedNames.push(name);
        } else {
          this.whitelist.delete(name);
          removedNames.push(name);
        }
      }
    }

    if (input.process_hashes) {
      for (const hash of input.process_hashes) {
        if (input.action === "add") {
          this.whitelist.add(`hash:${hash}`);
          addedHashes.push(hash);
        } else {
          this.whitelist.delete(`hash:${hash}`);
          removedHashes.push(hash);
        }
      }
    }

    return {
      summary: `Whitelist ${input.action === "add" ? "updated: added" : "updated: removed"} ${addedNames.length + addedHashes.length + removedNames.length + removedHashes.length} entry(ies).`,
      structured_output: {
        updated_at: new Date().toISOString(),
        action: input.action,
        added_names: addedNames,
        removed_names: removedNames,
        added_hashes: addedHashes,
        removed_hashes: removedHashes,
        whitelist_size: this.whitelist.size,
      },
    };
  }

  async networkAudit(
    input: SecurityNetworkAuditInput,
  ): Promise<ExecutionOutcome<SecurityNetworkAuditOutput>> {
    try {
      const rawConnections = await auditConnections(this.psRunner);

      let connections: NetworkConnectionEntry[] = rawConnections.map((c) => {
        const suspicion = isSuspiciousConnection(c);
        return {
          local_address: c.localAddress,
          local_port: c.localPort,
          remote_address: c.remoteAddress,
          remote_port: c.remotePort,
          state: c.state,
          process_name: c.processName,
          pid: c.pid,
          suspicious: suspicion.suspicious,
          suspicious_reason: suspicion.reason,
        };
      });

      // Apply filters
      if (!input.include_listening) {
        connections = connections.filter((c) => c.state !== "Listen" && c.state !== "LISTEN");
      }
      if (!input.include_established) {
        connections = connections.filter((c) => c.state !== "Established" && c.state !== "ESTABLISHED");
      }
      if (input.suspicious_only) {
        connections = connections.filter((c) => c.suspicious);
      }

      const suspiciousCount = connections.filter((c) => c.suspicious).length;
      const listeningCount = connections.filter((c) =>
        c.state === "Listen" || c.state === "LISTEN",
      ).length;
      const establishedCount = connections.filter((c) =>
        c.state === "Established" || c.state === "ESTABLISHED",
      ).length;

      return {
        summary: `Audited ${connections.length} connection(s). ${suspiciousCount} suspicious.`,
        structured_output: {
          audited_at: new Date().toISOString(),
          total_connections: connections.length,
          suspicious_count: suspiciousCount,
          listening_count: listeningCount,
          established_count: establishedCount,
          connections,
        },
      };
    } catch (error) {
      throw new SecurityWorkerError(
        "NETWORK_AUDIT_FAILED",
        `Network audit failed: ${error instanceof Error ? error.message : "unknown error"}`,
        true,
      );
    }
  }

  async fileIntegrityCheck(
    input: SecurityFileIntegrityCheckInput,
  ): Promise<ExecutionOutcome<SecurityFileIntegrityCheckOutput>> {
    try {
      const files = await computeFileHashes(input.paths);

      let diff: { added: string[]; removed: string[]; modified: string[]; unchanged: number } | undefined;
      let baselineLabel: string | undefined;

      if (input.baseline_id) {
        const baseline = this.baselines.get(input.baseline_id);
        if (baseline) {
          diff = compareWithBaseline(files, baseline.files);
          baselineLabel = baseline.label;
        }
      }

      const fileEntries: FileHashEntry[] = files.map((f) => ({
        path: f.path,
        hash: f.hash,
        size: f.size,
        last_modified: f.lastModified,
      }));

      return {
        summary: `Checked ${files.length} file(s).${diff ? ` Changes: +${diff.added.length} added, -${diff.removed.length} removed, ~${diff.modified.length} modified.` : ""}`,
        structured_output: {
          checked_at: new Date().toISOString(),
          baseline_id: input.baseline_id,
          baseline_label: baselineLabel,
          files: fileEntries,
          diff,
        },
      };
    } catch (error) {
      throw new SecurityWorkerError(
        "FILE_INTEGRITY_FAILED",
        `File integrity check failed: ${error instanceof Error ? error.message : "unknown error"}`,
        true,
      );
    }
  }

  async fileIntegrityBaseline(
    input: SecurityFileIntegrityBaselineInput,
  ): Promise<ExecutionOutcome<SecurityFileIntegrityBaselineOutput>> {
    try {
      const baselineId = randomUUID();
      const files = await computeFileHashes(input.paths);

      this.baselines.set(baselineId, {
        files,
        label: input.label,
        createdAt: new Date().toISOString(),
      });

      const fileEntries: FileHashEntry[] = files.map((f) => ({
        path: f.path,
        hash: f.hash,
        size: f.size,
        last_modified: f.lastModified,
      }));

      return {
        summary: `Created baseline '${input.label ?? baselineId}' with ${files.length} file(s).`,
        structured_output: {
          baseline_id: baselineId,
          created_at: new Date().toISOString(),
          label: input.label,
          file_count: files.length,
          files: fileEntries,
        },
      };
    } catch (error) {
      throw new SecurityWorkerError(
        "BASELINE_FAILED",
        `File integrity baseline creation failed: ${error instanceof Error ? error.message : "unknown error"}`,
        true,
      );
    }
  }

  async firewallRule(
    input: SecurityFirewallRuleInput,
  ): Promise<ExecutionOutcome<SecurityFirewallRuleOutput>> {
    try {
      if (input.action === "list") {
        const rules = await listFirewallRules(this.cmdRunner);
        return {
          summary: `Listed ${rules.length} firewall rule(s).`,
          structured_output: {
            applied_at: new Date().toISOString(),
            operation: "list",
            rules,
            success: true,
            message: `${rules.length} rule(s) found.`,
          },
        };
      }

      if (input.action === "add") {
        const result = await addFirewallRule(this.cmdRunner, input);
        const ruleName = input.rule_name ?? `Jarvis-Security-${Date.now()}`;
        return {
          summary: result.success ? `Added firewall rule '${ruleName}'.` : `Failed to add firewall rule: ${result.message}`,
          structured_output: {
            applied_at: new Date().toISOString(),
            operation: "add",
            rule_name: ruleName,
            success: result.success,
            message: result.message,
          },
        };
      }

      // action === "remove"
      const ruleName = input.rule_name ?? "";
      if (!ruleName) {
        return {
          summary: "Cannot remove firewall rule: no rule_name provided.",
          structured_output: {
            applied_at: new Date().toISOString(),
            operation: "remove",
            rule_name: "",
            success: false,
            message: "No rule_name provided for removal.",
          },
        };
      }

      const result = await removeFirewallRule(this.cmdRunner, ruleName);
      return {
        summary: result.success ? `Removed firewall rule '${ruleName}'.` : `Failed to remove firewall rule: ${result.message}`,
        structured_output: {
          applied_at: new Date().toISOString(),
          operation: "remove",
          rule_name: ruleName,
          success: result.success,
          message: result.message,
        },
      };
    } catch (error) {
      throw new SecurityWorkerError(
        "FIREWALL_FAILED",
        `Firewall operation failed: ${error instanceof Error ? error.message : "unknown error"}`,
        false,
      );
    }
  }

  async lockdown(
    input: SecurityLockdownInput,
  ): Promise<ExecutionOutcome<SecurityLockdownOutput>> {
    try {
      const result = await executeLockdown(this.lockdownRunner, input, this.whitelist);

      return {
        summary: `Lockdown (${input.level}) activated. ${result.processes_killed} process(es) killed, ${result.firewall_rules_added} rule(s) added.`,
        structured_output: result,
      };
    } catch (error) {
      throw new SecurityWorkerError(
        "LOCKDOWN_FAILED",
        `Lockdown failed: ${error instanceof Error ? error.message : "unknown error"}`,
        false,
      );
    }
  }
}

export function createRealSecurityAdapter(options?: RealSecurityAdapterOptions): SecurityAdapter {
  return new RealSecurityAdapter(options);
}
