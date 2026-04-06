// ── Scan Processes ────────────────────────────────────────────────────────────

export type SecurityScanProcessesInput = {
  whitelist_only: boolean;
};

export type ProcessScanEntry = {
  pid: number;
  name: string;
  path?: string;
  hash?: string;
  cpu_percent: number;
  memory_mb: number;
  user: string;
  whitelisted: boolean;
  suspicious: boolean;
  suspicious_reason?: string;
};

export type SecurityScanProcessesOutput = {
  scanned_at: string;
  total_count: number;
  suspicious_count: number;
  non_whitelisted_count: number;
  processes: ProcessScanEntry[];
};

// ── Whitelist Update ──────────────────────────────────────────────────────────

export type SecurityWhitelistUpdateInput = {
  action: "add" | "remove";
  process_names?: string[];
  process_hashes?: string[];
};

export type SecurityWhitelistUpdateOutput = {
  updated_at: string;
  action: "add" | "remove";
  added_names: string[];
  removed_names: string[];
  added_hashes: string[];
  removed_hashes: string[];
  whitelist_size: number;
};

// ── Network Audit ─────────────────────────────────────────────────────────────

export type SecurityNetworkAuditInput = {
  include_listening: boolean;
  include_established: boolean;
  suspicious_only: boolean;
};

export type NetworkConnectionEntry = {
  local_address: string;
  local_port: number;
  remote_address: string;
  remote_port: number;
  state: string;
  process_name?: string;
  pid?: number;
  suspicious: boolean;
  suspicious_reason?: string;
};

export type SecurityNetworkAuditOutput = {
  audited_at: string;
  total_connections: number;
  suspicious_count: number;
  listening_count: number;
  established_count: number;
  connections: NetworkConnectionEntry[];
};

// ── File Integrity Check ──────────────────────────────────────────────────────

export type SecurityFileIntegrityCheckInput = {
  paths: string[];
  baseline_id?: string;
};

export type FileHashEntry = {
  path: string;
  hash: string;
  size: number;
  last_modified: string;
};

export type FileIntegrityDiff = {
  added: string[];
  removed: string[];
  modified: string[];
  unchanged: number;
};

export type SecurityFileIntegrityCheckOutput = {
  checked_at: string;
  baseline_id?: string;
  baseline_label?: string;
  files: FileHashEntry[];
  diff?: FileIntegrityDiff;
};

// ── File Integrity Baseline ───────────────────────────────────────────────────

export type SecurityFileIntegrityBaselineInput = {
  paths: string[];
  label?: string;
};

export type SecurityFileIntegrityBaselineOutput = {
  baseline_id: string;
  created_at: string;
  label?: string;
  file_count: number;
  files: FileHashEntry[];
};

// ── Firewall Rule ─────────────────────────────────────────────────────────────

export type SecurityFirewallRuleInput = {
  action: "add" | "remove" | "list";
  direction?: "inbound" | "outbound";
  port?: number;
  protocol?: "tcp" | "udp";
  program?: string;
  rule_name?: string;
};

export type FirewallRuleEntry = {
  name: string;
  direction: "inbound" | "outbound";
  action: "allow" | "block";
  protocol?: string;
  local_port?: number;
  program?: string;
  enabled: boolean;
};

export type SecurityFirewallRuleOutput = {
  applied_at: string;
  operation: "add" | "remove" | "list";
  rule_name?: string;
  rules?: FirewallRuleEntry[];
  success: boolean;
  message: string;
};

// ── Lockdown ──────────────────────────────────────────────────────────────────

export type SecurityLockdownInput = {
  level: "standard" | "maximum";
  kill_non_whitelisted: boolean;
  block_outbound: boolean;
  lock_screen: boolean;
};

export type LockdownAction = {
  action: string;
  success: boolean;
  details?: string;
};

export type SecurityLockdownOutput = {
  activated_at: string;
  level: "standard" | "maximum";
  actions_taken: LockdownAction[];
  processes_killed: number;
  firewall_rules_added: number;
  screen_locked: boolean;
};
