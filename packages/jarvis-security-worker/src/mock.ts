import { randomUUID } from "node:crypto";
import type { ExecutionOutcome, SecurityAdapter } from "./adapter.js";
import type {
  SecurityScanProcessesInput,
  SecurityScanProcessesOutput,
  SecurityWhitelistUpdateInput,
  SecurityWhitelistUpdateOutput,
  SecurityNetworkAuditInput,
  SecurityNetworkAuditOutput,
  SecurityFileIntegrityCheckInput,
  SecurityFileIntegrityCheckOutput,
  SecurityFileIntegrityBaselineInput,
  SecurityFileIntegrityBaselineOutput,
  SecurityFirewallRuleInput,
  SecurityFirewallRuleOutput,
  SecurityLockdownInput,
  SecurityLockdownOutput,
  FirewallRuleEntry
} from "./types.js";
import { compareWithBaseline } from "./file-integrity.js";
import type { FileHash } from "./file-integrity.js";

const MOCK_NOW = "2026-04-04T12:00:00.000Z";

const MOCK_PROCESSES = [
  { pid: 1204, name: "chrome.exe", path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", hash: "aabbcc", cpuPercent: 8.7, memoryMb: 892.3, user: "daniel", whitelisted: true },
  { pid: 4312, name: "Code.exe", path: "C:\\Users\\daniel\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe", hash: "ddeeff", cpuPercent: 5.2, memoryMb: 1024.5, user: "daniel", whitelisted: true },
  { pid: 2088, name: "node.exe", path: "C:\\Program Files\\nodejs\\node.exe", hash: "112233", cpuPercent: 3.1, memoryMb: 512.0, user: "daniel", whitelisted: true },
  { pid: 9801, name: "suspicious.exe", path: "C:\\Temp\\suspicious.exe", hash: "deadbeef", cpuPercent: 15.3, memoryMb: 128.0, user: "SYSTEM", whitelisted: false }
];

const MOCK_CONNECTIONS = [
  { localAddress: "0.0.0.0", localPort: 3389, remoteAddress: "0.0.0.0", remotePort: 0, state: "LISTEN", processName: "svchost.exe", pid: 1024 },
  { localAddress: "192.168.1.100", localPort: 54321, remoteAddress: "8.8.8.8", remotePort: 443, state: "ESTABLISHED", processName: "chrome.exe", pid: 1204 },
  { localAddress: "192.168.1.100", localPort: 59999, remoteAddress: "203.0.113.99", remotePort: 4444, state: "ESTABLISHED", processName: "suspicious.exe", pid: 9801 }
];

const MOCK_BASELINE_FILES: FileHash[] = [
  { path: "C:\\Windows\\System32\\cmd.exe", hash: "aabb1122", size: 329216, lastModified: "2026-01-01T00:00:00.000Z" },
  { path: "C:\\Windows\\System32\\notepad.exe", hash: "ccdd3344", size: 203264, lastModified: "2026-01-01T00:00:00.000Z" }
];

export class MockSecurityAdapter implements SecurityAdapter {
  private whitelist: Set<string> = new Set(["chrome.exe", "Code.exe", "node.exe", "explorer.exe", "svchost.exe"]);
  private baselines: Map<string, { files: FileHash[]; label?: string; createdAt: string }> = new Map();
  private firewallRules: FirewallRuleEntry[] = [
    { name: "Jarvis-Allow-HTTP", direction: "outbound", action: "allow", protocol: "tcp", local_port: 80, enabled: true },
    { name: "Jarvis-Allow-HTTPS", direction: "outbound", action: "allow", protocol: "tcp", local_port: 443, enabled: true }
  ];

  getWhitelist(): Set<string> {
    return new Set(this.whitelist);
  }

  getBaselines(): Map<string, { files: FileHash[]; label?: string; createdAt: string }> {
    return new Map(this.baselines);
  }

  async scanProcesses(
    input: SecurityScanProcessesInput,
  ): Promise<ExecutionOutcome<SecurityScanProcessesOutput>> {
    const processes = MOCK_PROCESSES.filter((p) =>
      !input.whitelist_only || !p.whitelisted
    ).map((p) => {
      const suspicious = !p.whitelisted && p.cpuPercent > 10;
      return {
        pid: p.pid,
        name: p.name,
        path: p.path,
        hash: p.hash,
        cpu_percent: p.cpuPercent,
        memory_mb: p.memoryMb,
        user: p.user,
        whitelisted: p.whitelisted,
        suspicious,
        suspicious_reason: suspicious ? "High CPU usage from non-whitelisted process" : undefined
      };
    });

    const suspiciousCount = processes.filter((p) => p.suspicious).length;
    const nonWhitelistedCount = processes.filter((p) => !p.whitelisted).length;

    return {
      summary: `Scanned ${processes.length} process(es). ${suspiciousCount} suspicious, ${nonWhitelistedCount} non-whitelisted.`,
      structured_output: {
        scanned_at: MOCK_NOW,
        total_count: processes.length,
        suspicious_count: suspiciousCount,
        non_whitelisted_count: nonWhitelistedCount,
        processes
      }
    };
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
        updated_at: MOCK_NOW,
        action: input.action,
        added_names: addedNames,
        removed_names: removedNames,
        added_hashes: addedHashes,
        removed_hashes: removedHashes,
        whitelist_size: this.whitelist.size
      }
    };
  }

  async networkAudit(
    input: SecurityNetworkAuditInput,
  ): Promise<ExecutionOutcome<SecurityNetworkAuditOutput>> {
    const SUSPICIOUS_PORTS = new Set([4444, 4445, 1337, 31337]);

    let connections = MOCK_CONNECTIONS.map((c) => {
      const suspicious = SUSPICIOUS_PORTS.has(c.remotePort);
      return {
        local_address: c.localAddress,
        local_port: c.localPort,
        remote_address: c.remoteAddress,
        remote_port: c.remotePort,
        state: c.state,
        process_name: c.processName,
        pid: c.pid,
        suspicious,
        suspicious_reason: suspicious ? `Known malicious port: ${c.remotePort}` : undefined
      };
    });

    if (!input.include_listening) {
      connections = connections.filter((c) => c.state !== "LISTEN");
    }
    if (!input.include_established) {
      connections = connections.filter((c) => c.state !== "ESTABLISHED");
    }
    if (input.suspicious_only) {
      connections = connections.filter((c) => c.suspicious);
    }

    const suspiciousCount = connections.filter((c) => c.suspicious).length;
    const listeningCount = connections.filter((c) => c.state === "LISTEN").length;
    const establishedCount = connections.filter((c) => c.state === "ESTABLISHED").length;

    return {
      summary: `Audited ${connections.length} connection(s). ${suspiciousCount} suspicious.`,
      structured_output: {
        audited_at: MOCK_NOW,
        total_connections: connections.length,
        suspicious_count: suspiciousCount,
        listening_count: listeningCount,
        established_count: establishedCount,
        connections
      }
    };
  }

  async fileIntegrityCheck(
    input: SecurityFileIntegrityCheckInput,
  ): Promise<ExecutionOutcome<SecurityFileIntegrityCheckOutput>> {
    const files: FileHash[] = input.paths.map((p) => ({
      path: p,
      hash: `mock-hash-${p.length.toString(16)}`,
      size: 204800,
      lastModified: MOCK_NOW
    }));

    let diff: { added: string[]; removed: string[]; modified: string[]; unchanged: number } | undefined;

    if (input.baseline_id) {
      const baseline = this.baselines.get(input.baseline_id);
      if (baseline) {
        diff = compareWithBaseline(files, baseline.files);
      }
    } else {
      diff = compareWithBaseline(files, MOCK_BASELINE_FILES);
    }

    const baselineEntry = input.baseline_id ? this.baselines.get(input.baseline_id) : undefined;

    return {
      summary: `Checked ${files.length} file(s).${diff ? ` Changes: +${diff.added.length} added, -${diff.removed.length} removed, ~${diff.modified.length} modified.` : ""}`,
      structured_output: {
        checked_at: MOCK_NOW,
        baseline_id: input.baseline_id,
        baseline_label: baselineEntry?.label,
        files: files.map(f => ({ path: f.path, hash: f.hash, size: f.size, last_modified: f.lastModified })),
        diff
      }
    };
  }

  async fileIntegrityBaseline(
    input: SecurityFileIntegrityBaselineInput,
  ): Promise<ExecutionOutcome<SecurityFileIntegrityBaselineOutput>> {
    const baselineId = randomUUID();
    const files: FileHash[] = input.paths.map((p) => ({
      path: p,
      hash: `mock-hash-${p.length.toString(16)}`,
      size: 204800,
      lastModified: MOCK_NOW
    }));

    this.baselines.set(baselineId, {
      files,
      label: input.label,
      createdAt: MOCK_NOW
    });

    return {
      summary: `Created baseline '${input.label ?? baselineId}' with ${files.length} file(s).`,
      structured_output: {
        baseline_id: baselineId,
        created_at: MOCK_NOW,
        label: input.label,
        file_count: files.length,
        files: files.map(f => ({ path: f.path, hash: f.hash, size: f.size, last_modified: f.lastModified }))
      }
    };
  }

  async firewallRule(
    input: SecurityFirewallRuleInput,
  ): Promise<ExecutionOutcome<SecurityFirewallRuleOutput>> {
    if (input.action === "list") {
      return {
        summary: `Listed ${this.firewallRules.length} firewall rule(s).`,
        structured_output: {
          applied_at: MOCK_NOW,
          operation: "list",
          rules: [...this.firewallRules],
          success: true,
          message: `${this.firewallRules.length} rule(s) found.`
        }
      };
    }

    const ruleName = input.rule_name ?? `Jarvis-Rule-${Date.now()}`;

    if (input.action === "add") {
      const newRule: FirewallRuleEntry = {
        name: ruleName,
        direction: input.direction ?? "inbound",
        action: "block",
        protocol: input.protocol,
        local_port: input.port,
        program: input.program,
        enabled: true
      };
      this.firewallRules.push(newRule);

      return {
        summary: `Added firewall rule '${ruleName}'.`,
        structured_output: {
          applied_at: MOCK_NOW,
          operation: "add",
          rule_name: ruleName,
          success: true,
          message: `Rule '${ruleName}' added successfully.`
        }
      };
    }

    // remove
    const index = this.firewallRules.findIndex((r) => r.name === ruleName);
    if (index >= 0) {
      this.firewallRules.splice(index, 1);
    }

    return {
      summary: `Removed firewall rule '${ruleName}'.`,
      structured_output: {
        applied_at: MOCK_NOW,
        operation: "remove",
        rule_name: ruleName,
        success: index >= 0,
        message: index >= 0 ? `Rule '${ruleName}' removed.` : `Rule '${ruleName}' not found.`
      }
    };
  }

  async lockdown(
    input: SecurityLockdownInput,
  ): Promise<ExecutionOutcome<SecurityLockdownOutput>> {
    const actions = [];
    let processesKilled = 0;
    let firewallRulesAdded = 0;

    if (input.kill_non_whitelisted) {
      processesKilled = MOCK_PROCESSES.filter((p) => !p.whitelisted).length;
      actions.push({
        action: "kill_non_whitelisted_processes",
        success: true,
        details: `Killed ${processesKilled} non-whitelisted process(es).`
      });
    }

    if (input.block_outbound) {
      firewallRulesAdded++;
      actions.push({
        action: "block_outbound_connections",
        success: true,
        details: "Outbound block rule added."
      });
    }

    if (input.level === "maximum") {
      firewallRulesAdded += 2;
      actions.push({ action: "block_rdp_inbound", success: true, details: "RDP blocked." });
      actions.push({ action: "block_smb_inbound", success: true, details: "SMB blocked." });
    }

    const screenLocked = input.lock_screen;
    if (screenLocked) {
      actions.push({ action: "lock_screen", success: true, details: "Workstation locked." });
    }

    return {
      summary: `Lockdown (${input.level}) activated. ${processesKilled} process(es) killed, ${firewallRulesAdded} rule(s) added.`,
      structured_output: {
        activated_at: MOCK_NOW,
        level: input.level,
        actions_taken: actions,
        processes_killed: processesKilled,
        firewall_rules_added: firewallRulesAdded,
        screen_locked: screenLocked
      }
    };
  }
}

export function createMockSecurityAdapter(): SecurityAdapter {
  return new MockSecurityAdapter();
}
