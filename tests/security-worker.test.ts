import { beforeEach, describe, expect, it } from "vitest";
import {
  CONTRACT_VERSION,
  resetJarvisState
} from "@jarvis/shared";
import {
  MockSecurityAdapter,
  createMockSecurityAdapter,
  createSecurityWorker,
  executeSecurityJob,
  isSecurityJobType,
  SECURITY_JOB_TYPES
} from "@jarvis/security-worker";
import { compareWithBaseline } from "@jarvis/security-worker";
import type { FileHash } from "@jarvis/security-worker";
import type { JobEnvelope } from "@jarvis/shared";

function makeEnvelope(
  type: string,
  input: Record<string, unknown> = {},
  overrides: Partial<JobEnvelope> = {},
): JobEnvelope {
  return {
    contract_version: CONTRACT_VERSION,
    job_id: `test-${Math.random().toString(36).slice(2)}`,
    type: type as JobEnvelope["type"],
    session_key: "agent:main:api:local:adhoc",
    requested_by: { channel: "api", user_id: "test-user" },
    priority: "normal",
    approval_state: "not_required",
    timeout_seconds: 30,
    attempt: 1,
    input,
    artifacts_in: [],
    retry_policy: { mode: "manual", max_attempts: 3 },
    metadata: {
      agent_id: "main",
      thread_key: null
    },
    ...overrides
  };
}

// ── File Integrity Comparison ─────────────────────────────────────────────────

describe("compareWithBaseline", () => {
  const baseline: FileHash[] = [
    { path: "C:\\file1.exe", hash: "aabb", size: 1024, lastModified: "2026-01-01T00:00:00.000Z" },
    { path: "C:\\file2.exe", hash: "ccdd", size: 2048, lastModified: "2026-01-01T00:00:00.000Z" },
    { path: "C:\\file3.exe", hash: "eeff", size: 4096, lastModified: "2026-01-01T00:00:00.000Z" }
  ];

  it("detects unchanged files", () => {
    const current: FileHash[] = [...baseline];
    const result = compareWithBaseline(current, baseline);
    expect(result.unchanged).toBe(3);
    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
    expect(result.modified).toHaveLength(0);
  });

  it("detects added files", () => {
    const current: FileHash[] = [
      ...baseline,
      { path: "C:\\newfile.exe", hash: "1234", size: 512, lastModified: "2026-04-01T00:00:00.000Z" }
    ];
    const result = compareWithBaseline(current, baseline);
    expect(result.added).toContain("C:\\newfile.exe");
    expect(result.unchanged).toBe(3);
  });

  it("detects removed files", () => {
    const current: FileHash[] = [baseline[0]!, baseline[1]!];
    const result = compareWithBaseline(current, baseline);
    expect(result.removed).toContain("C:\\file3.exe");
    expect(result.unchanged).toBe(2);
  });

  it("detects modified files", () => {
    const current: FileHash[] = [
      { path: "C:\\file1.exe", hash: "DIFFERENT", size: 1024, lastModified: "2026-04-01T00:00:00.000Z" },
      baseline[1]!,
      baseline[2]!
    ];
    const result = compareWithBaseline(current, baseline);
    expect(result.modified).toContain("C:\\file1.exe");
    expect(result.unchanged).toBe(2);
  });

  it("handles empty current vs non-empty baseline", () => {
    const result = compareWithBaseline([], baseline);
    expect(result.removed).toHaveLength(3);
    expect(result.added).toHaveLength(0);
    expect(result.unchanged).toBe(0);
  });

  it("handles empty baseline vs non-empty current", () => {
    const result = compareWithBaseline(baseline, []);
    expect(result.added).toHaveLength(3);
    expect(result.removed).toHaveLength(0);
    expect(result.unchanged).toBe(0);
  });

  it("handles both empty", () => {
    const result = compareWithBaseline([], []);
    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
    expect(result.modified).toHaveLength(0);
    expect(result.unchanged).toBe(0);
  });
});

// ── SECURITY_JOB_TYPES ────────────────────────────────────────────────────────

describe("SECURITY_JOB_TYPES", () => {
  it("contains all 7 security job types", () => {
    expect(SECURITY_JOB_TYPES).toHaveLength(7);
    expect(SECURITY_JOB_TYPES).toContain("security.scan_processes");
    expect(SECURITY_JOB_TYPES).toContain("security.whitelist_update");
    expect(SECURITY_JOB_TYPES).toContain("security.network_audit");
    expect(SECURITY_JOB_TYPES).toContain("security.file_integrity_check");
    expect(SECURITY_JOB_TYPES).toContain("security.file_integrity_baseline");
    expect(SECURITY_JOB_TYPES).toContain("security.firewall_rule");
    expect(SECURITY_JOB_TYPES).toContain("security.lockdown");
  });
});

describe("isSecurityJobType", () => {
  it("returns true for known security job types", () => {
    for (const type of SECURITY_JOB_TYPES) {
      expect(isSecurityJobType(type)).toBe(true);
    }
  });

  it("returns false for unknown job types", () => {
    expect(isSecurityJobType("device.snapshot")).toBe(false);
    expect(isSecurityJobType("system.monitor_cpu")).toBe(false);
    expect(isSecurityJobType("unknown.job")).toBe(false);
    expect(isSecurityJobType("")).toBe(false);
  });
});

// ── MockSecurityAdapter ───────────────────────────────────────────────────────

describe("MockSecurityAdapter", () => {
  let adapter: MockSecurityAdapter;

  beforeEach(() => {
    adapter = new MockSecurityAdapter();
  });

  describe("scanProcesses", () => {
    it("returns all processes when whitelist_only is false", async () => {
      const result = await adapter.scanProcesses({ whitelist_only: false });
      expect(result.structured_output.total_count).toBeGreaterThan(0);
      expect(result.structured_output.processes.length).toBe(result.structured_output.total_count);
    });

    it("returns only non-whitelisted when whitelist_only is true", async () => {
      const result = await adapter.scanProcesses({ whitelist_only: true });
      expect(result.structured_output.processes.every((p) => !p.whitelisted)).toBe(true);
    });

    it("reports suspicious count correctly", async () => {
      const result = await adapter.scanProcesses({ whitelist_only: false });
      const actualSuspicious = result.structured_output.processes.filter((p) => p.suspicious).length;
      expect(result.structured_output.suspicious_count).toBe(actualSuspicious);
    });

    it("process entry has correct shape", async () => {
      const result = await adapter.scanProcesses({ whitelist_only: false });
      const proc = result.structured_output.processes[0]!;
      expect(proc).toMatchObject({
        pid: expect.any(Number),
        name: expect.any(String),
        cpu_percent: expect.any(Number),
        memory_mb: expect.any(Number),
        user: expect.any(String),
        whitelisted: expect.any(Boolean),
        suspicious: expect.any(Boolean)
      });
    });
  });

  describe("whitelistUpdate", () => {
    it("adds process names to the whitelist", async () => {
      const before = adapter.getWhitelist().size;
      const result = await adapter.whitelistUpdate({
        action: "add",
        process_names: ["paint.exe", "calc.exe"]
      });
      expect(result.structured_output.added_names).toContain("paint.exe");
      expect(result.structured_output.added_names).toContain("calc.exe");
      expect(adapter.getWhitelist().size).toBe(before + 2);
    });

    it("removes process names from the whitelist", async () => {
      await adapter.whitelistUpdate({ action: "add", process_names: ["remove-me.exe"] });
      const before = adapter.getWhitelist().size;
      const result = await adapter.whitelistUpdate({
        action: "remove",
        process_names: ["remove-me.exe"]
      });
      expect(result.structured_output.removed_names).toContain("remove-me.exe");
      expect(adapter.getWhitelist().size).toBe(before - 1);
    });

    it("adds process hashes", async () => {
      const result = await adapter.whitelistUpdate({
        action: "add",
        process_hashes: ["deadbeef1234"]
      });
      expect(result.structured_output.added_hashes).toContain("deadbeef1234");
    });

    it("whitelist_size reflects current size", async () => {
      const result = await adapter.whitelistUpdate({ action: "add", process_names: ["x.exe"] });
      expect(result.structured_output.whitelist_size).toBe(adapter.getWhitelist().size);
    });
  });

  describe("networkAudit", () => {
    it("returns connections with required fields", async () => {
      const result = await adapter.networkAudit({
        include_listening: true,
        include_established: true,
        suspicious_only: false
      });
      expect(result.structured_output.total_connections).toBeGreaterThan(0);
      const conn = result.structured_output.connections[0]!;
      expect(conn).toMatchObject({
        local_address: expect.any(String),
        local_port: expect.any(Number),
        remote_address: expect.any(String),
        remote_port: expect.any(Number),
        state: expect.any(String),
        suspicious: expect.any(Boolean)
      });
    });

    it("filters to suspicious_only", async () => {
      const result = await adapter.networkAudit({
        include_listening: true,
        include_established: true,
        suspicious_only: true
      });
      expect(result.structured_output.connections.every((c) => c.suspicious)).toBe(true);
    });

    it("excludes listening connections when include_listening is false", async () => {
      const result = await adapter.networkAudit({
        include_listening: false,
        include_established: true,
        suspicious_only: false
      });
      expect(result.structured_output.connections.every((c) => c.state !== "LISTEN")).toBe(true);
    });

    it("counts match filtered list", async () => {
      const result = await adapter.networkAudit({
        include_listening: true,
        include_established: true,
        suspicious_only: false
      });
      expect(result.structured_output.suspicious_count).toBe(
        result.structured_output.connections.filter((c) => c.suspicious).length
      );
    });
  });

  describe("fileIntegrityCheck", () => {
    it("returns file entries for provided paths", async () => {
      const result = await adapter.fileIntegrityCheck({
        paths: ["C:\\Windows\\System32\\cmd.exe", "C:\\Windows\\System32\\notepad.exe"]
      });
      expect(result.structured_output.files).toHaveLength(2);
      expect(result.structured_output.files[0]!.hash).toBeTruthy();
      expect(result.structured_output.files[0]!.size).toBeGreaterThan(0);
    });

    it("returns diff when baseline_id is provided", async () => {
      // Create a baseline first
      const baseline = await adapter.fileIntegrityBaseline({
        paths: ["C:\\Windows\\System32\\cmd.exe"],
        label: "test-baseline"
      });
      const baselineId = baseline.structured_output.baseline_id;

      const result = await adapter.fileIntegrityCheck({
        paths: ["C:\\Windows\\System32\\cmd.exe"],
        baseline_id: baselineId
      });
      expect(result.structured_output.diff).toBeDefined();
      expect(result.structured_output.baseline_id).toBe(baselineId);
    });

    it("returns diff against default baseline when no baseline_id", async () => {
      const result = await adapter.fileIntegrityCheck({
        paths: ["C:\\Windows\\System32\\cmd.exe"]
      });
      expect(result.structured_output.diff).toBeDefined();
    });
  });

  describe("fileIntegrityBaseline", () => {
    it("creates a baseline with a unique ID", async () => {
      const result = await adapter.fileIntegrityBaseline({
        paths: ["C:\\file1.exe", "C:\\file2.exe"],
        label: "my-baseline"
      });
      expect(result.structured_output.baseline_id).toBeTruthy();
      expect(result.structured_output.label).toBe("my-baseline");
      expect(result.structured_output.file_count).toBe(2);
      expect(result.structured_output.files).toHaveLength(2);
      expect(result.structured_output.created_at).toBeTruthy();
    });

    it("stores the baseline for later retrieval", async () => {
      const result = await adapter.fileIntegrityBaseline({
        paths: ["C:\\file.exe"]
      });
      expect(adapter.getBaselines().has(result.structured_output.baseline_id)).toBe(true);
    });

    it("two baselines have different IDs", async () => {
      const b1 = await adapter.fileIntegrityBaseline({ paths: ["C:\\a.exe"] });
      const b2 = await adapter.fileIntegrityBaseline({ paths: ["C:\\b.exe"] });
      expect(b1.structured_output.baseline_id).not.toBe(b2.structured_output.baseline_id);
    });
  });

  describe("firewallRule", () => {
    it("lists existing rules", async () => {
      const result = await adapter.firewallRule({ action: "list" });
      expect(result.structured_output.operation).toBe("list");
      expect(Array.isArray(result.structured_output.rules)).toBe(true);
      expect(result.structured_output.success).toBe(true);
    });

    it("adds a rule", async () => {
      const result = await adapter.firewallRule({
        action: "add",
        direction: "inbound",
        port: 4444,
        protocol: "tcp",
        rule_name: "TestBlock-4444"
      });
      expect(result.structured_output.operation).toBe("add");
      expect(result.structured_output.rule_name).toBe("TestBlock-4444");
      expect(result.structured_output.success).toBe(true);
    });

    it("removes a rule that was added", async () => {
      await adapter.firewallRule({ action: "add", rule_name: "ToRemove" });
      const result = await adapter.firewallRule({ action: "remove", rule_name: "ToRemove" });
      expect(result.structured_output.operation).toBe("remove");
      expect(result.structured_output.success).toBe(true);
    });

    it("generates a rule_name when not provided for add", async () => {
      const result = await adapter.firewallRule({ action: "add", port: 9999 });
      expect(result.structured_output.rule_name).toBeTruthy();
    });
  });

  describe("lockdown", () => {
    it("standard lockdown kills processes and adds rules", async () => {
      const result = await adapter.lockdown({
        level: "standard",
        kill_non_whitelisted: true,
        block_outbound: true,
        lock_screen: true
      });
      expect(result.structured_output.level).toBe("standard");
      expect(result.structured_output.processes_killed).toBeGreaterThan(0);
      expect(result.structured_output.firewall_rules_added).toBeGreaterThan(0);
      expect(result.structured_output.screen_locked).toBe(true);
    });

    it("maximum lockdown adds extra firewall rules", async () => {
      const standard = await adapter.lockdown({
        level: "standard",
        kill_non_whitelisted: false,
        block_outbound: true,
        lock_screen: false
      });
      const maximum = await adapter.lockdown({
        level: "maximum",
        kill_non_whitelisted: false,
        block_outbound: true,
        lock_screen: false
      });
      expect(maximum.structured_output.firewall_rules_added).toBeGreaterThan(
        standard.structured_output.firewall_rules_added
      );
    });

    it("screen_locked is false when lock_screen is false", async () => {
      const result = await adapter.lockdown({
        level: "standard",
        kill_non_whitelisted: false,
        block_outbound: false,
        lock_screen: false
      });
      expect(result.structured_output.screen_locked).toBe(false);
    });

    it("actions_taken is an array", async () => {
      const result = await adapter.lockdown({
        level: "standard",
        kill_non_whitelisted: false,
        block_outbound: false,
        lock_screen: false
      });
      expect(Array.isArray(result.structured_output.actions_taken)).toBe(true);
    });
  });
});

// ── executeSecurityJob ────────────────────────────────────────────────────────

describe("executeSecurityJob", () => {
  let adapter: MockSecurityAdapter;

  beforeEach(() => {
    resetJarvisState();
    adapter = new MockSecurityAdapter();
  });

  it("produces a completed JobResult for security.scan_processes", async () => {
    const envelope = makeEnvelope("security.scan_processes", { whitelist_only: false });
    const result = await executeSecurityJob(envelope, adapter);

    expect(result.contract_version).toBe(CONTRACT_VERSION);
    expect(result.job_id).toBe(envelope.job_id);
    expect(result.job_type).toBe("security.scan_processes");
    expect(result.status).toBe("completed");
    expect(result.attempt).toBe(1);
    expect(result.metrics?.worker_id).toBe("security-worker");
    expect(result.metrics?.started_at).toBeTruthy();
    expect(result.metrics?.finished_at).toBeTruthy();
    const out = result.structured_output as Record<string, unknown>;
    expect(typeof out["total_count"]).toBe("number");
    expect(Array.isArray(out["processes"])).toBe(true);
  });

  it("produces a completed JobResult for security.whitelist_update", async () => {
    const envelope = makeEnvelope("security.whitelist_update", {
      action: "add",
      process_names: ["new.exe"]
    });
    const result = await executeSecurityJob(envelope, adapter);
    expect(result.status).toBe("completed");
    expect(result.job_type).toBe("security.whitelist_update");
    const out = result.structured_output as Record<string, unknown>;
    expect(out["action"]).toBe("add");
  });

  it("produces a completed JobResult for security.network_audit", async () => {
    const envelope = makeEnvelope("security.network_audit", {
      include_listening: true,
      include_established: true,
      suspicious_only: false
    });
    const result = await executeSecurityJob(envelope, adapter);
    expect(result.status).toBe("completed");
    expect(result.job_type).toBe("security.network_audit");
    const out = result.structured_output as Record<string, unknown>;
    expect(typeof out["total_connections"]).toBe("number");
    expect(Array.isArray(out["connections"])).toBe(true);
  });

  it("produces a completed JobResult for security.file_integrity_check", async () => {
    const envelope = makeEnvelope("security.file_integrity_check", {
      paths: ["C:\\Windows\\System32\\cmd.exe"]
    });
    const result = await executeSecurityJob(envelope, adapter);
    expect(result.status).toBe("completed");
    expect(result.job_type).toBe("security.file_integrity_check");
    const out = result.structured_output as Record<string, unknown>;
    expect(Array.isArray(out["files"])).toBe(true);
  });

  it("produces a completed JobResult for security.file_integrity_baseline", async () => {
    const envelope = makeEnvelope("security.file_integrity_baseline", {
      paths: ["C:\\Windows\\System32\\cmd.exe"],
      label: "test"
    });
    const result = await executeSecurityJob(envelope, adapter);
    expect(result.status).toBe("completed");
    expect(result.job_type).toBe("security.file_integrity_baseline");
    const out = result.structured_output as Record<string, unknown>;
    expect(typeof out["baseline_id"]).toBe("string");
    expect(out["file_count"]).toBe(1);
  });

  it("produces a completed JobResult for security.firewall_rule", async () => {
    const envelope = makeEnvelope("security.firewall_rule", { action: "list" });
    const result = await executeSecurityJob(envelope, adapter);
    expect(result.status).toBe("completed");
    expect(result.job_type).toBe("security.firewall_rule");
    const out = result.structured_output as Record<string, unknown>;
    expect(out["operation"]).toBe("list");
  });

  it("produces a completed JobResult for security.lockdown", async () => {
    const envelope = makeEnvelope("security.lockdown", {
      level: "standard",
      kill_non_whitelisted: true,
      block_outbound: false,
      lock_screen: false
    });
    const result = await executeSecurityJob(envelope, adapter);
    expect(result.status).toBe("completed");
    expect(result.job_type).toBe("security.lockdown");
    const out = result.structured_output as Record<string, unknown>;
    expect(out["level"]).toBe("standard");
  });

  it("returns failed status for unsupported job type", async () => {
    const envelope = makeEnvelope("device.snapshot", {});
    const result = await executeSecurityJob(envelope, adapter);
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("INVALID_INPUT");
    expect(result.error?.message).toContain("device.snapshot");
    expect(result.error?.retryable).toBe(false);
  });

  it("wraps generic Error from adapter into INTERNAL_ERROR", async () => {
    const faultyAdapter = new MockSecurityAdapter();
    (faultyAdapter as unknown as { scanProcesses: unknown }).scanProcesses = async () => {
      throw new Error("Unexpected failure");
    };
    const envelope = makeEnvelope("security.scan_processes", { whitelist_only: false });
    const result = await executeSecurityJob(envelope, faultyAdapter);
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("INTERNAL_ERROR");
    expect(result.error?.message).toBe("Unexpected failure");
  });

  it("uses custom workerId when provided", async () => {
    const envelope = makeEnvelope("security.network_audit", {
      include_listening: true,
      include_established: true,
      suspicious_only: false
    });
    const result = await executeSecurityJob(envelope, adapter, {
      workerId: "custom-security-worker"
    });
    expect(result.status).toBe("completed");
    expect(result.metrics?.worker_id).toBe("custom-security-worker");
  });
});

// ── createSecurityWorker ──────────────────────────────────────────────────────

describe("createSecurityWorker", () => {
  beforeEach(() => {
    resetJarvisState();
  });

  it("exposes a default workerId", () => {
    const worker = createSecurityWorker({ adapter: createMockSecurityAdapter() });
    expect(worker.workerId).toBe("security-worker");
  });

  it("uses the provided workerId", () => {
    const worker = createSecurityWorker({
      adapter: createMockSecurityAdapter(),
      workerId: "my-security-worker"
    });
    expect(worker.workerId).toBe("my-security-worker");
  });

  it("executes a job via the worker facade", async () => {
    const worker = createSecurityWorker({ adapter: createMockSecurityAdapter() });
    const envelope = makeEnvelope("security.scan_processes", { whitelist_only: false });
    const result = await worker.execute(envelope);
    expect(result.status).toBe("completed");
    expect(result.metrics?.worker_id).toBe("security-worker");
    const out = result.structured_output as Record<string, unknown>;
    expect(Array.isArray(out["processes"])).toBe(true);
  });
});
