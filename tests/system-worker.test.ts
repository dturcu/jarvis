import { beforeEach, describe, expect, it } from "vitest";
import {
  CONTRACT_VERSION,
  resetJarvisState
} from "@jarvis/shared";
import {
  MockSystemAdapter,
  createMockSystemAdapter,
  createSystemWorker,
  executeSystemJob,
  isSystemJobType,
  SYSTEM_JOB_TYPES
} from "@jarvis/system-worker";
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

describe("SYSTEM_JOB_TYPES", () => {
  it("contains all 8 system job types", () => {
    expect(SYSTEM_JOB_TYPES).toHaveLength(8);
    expect(SYSTEM_JOB_TYPES).toContain("system.monitor_cpu");
    expect(SYSTEM_JOB_TYPES).toContain("system.monitor_memory");
    expect(SYSTEM_JOB_TYPES).toContain("system.monitor_disk");
    expect(SYSTEM_JOB_TYPES).toContain("system.monitor_network");
    expect(SYSTEM_JOB_TYPES).toContain("system.monitor_battery");
    expect(SYSTEM_JOB_TYPES).toContain("system.list_processes");
    expect(SYSTEM_JOB_TYPES).toContain("system.kill_process");
    expect(SYSTEM_JOB_TYPES).toContain("system.hardware_info");
  });
});

describe("isSystemJobType", () => {
  it("returns true for known system job types", () => {
    for (const type of SYSTEM_JOB_TYPES) {
      expect(isSystemJobType(type)).toBe(true);
    }
  });

  it("returns false for unknown job types", () => {
    expect(isSystemJobType("device.snapshot")).toBe(false);
    expect(isSystemJobType("office.inspect")).toBe(false);
    expect(isSystemJobType("unknown.job")).toBe(false);
    expect(isSystemJobType("")).toBe(false);
  });
});

describe("MockSystemAdapter", () => {
  let adapter: MockSystemAdapter;

  beforeEach(() => {
    adapter = new MockSystemAdapter();
  });

  describe("monitorCpu", () => {
    it("returns overall CPU percentage", async () => {
      const result = await adapter.monitorCpu({ per_core: false });
      expect(result.summary).toContain("42%");
      expect(result.structured_output.overall_percent).toBe(42);
      expect(result.structured_output.cores).toBeUndefined();
    });

    it("returns per-core breakdown when requested", async () => {
      const result = await adapter.monitorCpu({ per_core: true });
      expect(result.structured_output.overall_percent).toBe(42);
      expect(result.structured_output.cores).toBeDefined();
      expect(result.structured_output.cores!.length).toBeGreaterThan(0);
      expect(result.structured_output.cores![0]).toMatchObject({
        core_id: 0,
        percent: expect.any(Number)
      });
    });

    it("includes load averages", async () => {
      const result = await adapter.monitorCpu({ per_core: false });
      expect(result.structured_output.load_averages).toMatchObject({
        one: 1.2,
        five: 0.9,
        fifteen: 0.7
      });
    });
  });

  describe("monitorMemory", () => {
    it("returns memory usage stats", async () => {
      const result = await adapter.monitorMemory({});
      expect(result.structured_output.total_mb).toBe(16384);
      expect(result.structured_output.used_mb).toBe(9216);
      expect(result.structured_output.free_mb).toBe(7168);
      expect(result.structured_output.percent_used).toBe(56.2);
    });

    it("omits top_consumers when top_n is not provided", async () => {
      const result = await adapter.monitorMemory({});
      expect(result.structured_output.top_consumers).toBeUndefined();
    });

    it("includes top_consumers when top_n is provided", async () => {
      const result = await adapter.monitorMemory({ top_n: 2 });
      expect(result.structured_output.top_consumers).toBeDefined();
      expect(result.structured_output.top_consumers!.length).toBeLessThanOrEqual(2);
      expect(result.structured_output.top_consumers![0]).toMatchObject({
        pid: expect.any(Number),
        name: expect.any(String),
        memory_mb: expect.any(Number),
        percent: expect.any(Number)
      });
    });
  });

  describe("monitorDisk", () => {
    it("returns all disk volumes when no path is specified", async () => {
      const result = await adapter.monitorDisk({});
      expect(result.structured_output.volumes.length).toBe(2);
    });

    it("filters volumes by path prefix", async () => {
      const result = await adapter.monitorDisk({ path: "C:" });
      expect(result.structured_output.volumes).toHaveLength(1);
      expect(result.structured_output.volumes[0]!.mount_point).toBe("C:");
    });

    it("volume has correct shape", async () => {
      const result = await adapter.monitorDisk({});
      const vol = result.structured_output.volumes[0]!;
      expect(vol).toMatchObject({
        mount_point: expect.any(String),
        total_gb: expect.any(Number),
        used_gb: expect.any(Number),
        free_gb: expect.any(Number),
        percent_used: expect.any(Number)
      });
    });
  });

  describe("monitorNetwork", () => {
    it("returns all network interfaces when no filter is specified", async () => {
      const result = await adapter.monitorNetwork({});
      expect(result.structured_output.interfaces.length).toBeGreaterThan(0);
    });

    it("filters by interface name", async () => {
      const result = await adapter.monitorNetwork({ interface_name: "Ethernet" });
      expect(result.structured_output.interfaces.length).toBeGreaterThan(0);
      expect(result.structured_output.interfaces[0]!.name).toContain("Ethernet");
    });

    it("returns empty when interface name does not match", async () => {
      const result = await adapter.monitorNetwork({ interface_name: "nonexistent-nic-99" });
      expect(result.structured_output.interfaces).toHaveLength(0);
    });

    it("interface has addresses", async () => {
      const result = await adapter.monitorNetwork({});
      const iface = result.structured_output.interfaces[0]!;
      expect(iface.addresses.length).toBeGreaterThan(0);
      expect(iface.addresses[0]).toMatchObject({
        family: expect.any(String),
        address: expect.any(String)
      });
    });
  });

  describe("monitorBattery", () => {
    it("returns battery information", async () => {
      const result = await adapter.monitorBattery();
      expect(result.structured_output.present).toBe(true);
      expect(result.structured_output.percent).toBe(78);
      expect(result.structured_output.status).toBe("discharging");
      expect(result.structured_output.time_remaining_seconds).toBe(7200);
    });

    it("summary mentions battery percentage", async () => {
      const result = await adapter.monitorBattery();
      expect(result.summary).toContain("78%");
    });
  });

  describe("listProcesses", () => {
    it("returns a list of processes", async () => {
      const result = await adapter.listProcesses({});
      expect(result.structured_output.processes.length).toBeGreaterThan(0);
      expect(result.structured_output.total_count).toBe(
        result.structured_output.processes.length
      );
    });

    it("sorts by cpu by default", async () => {
      const result = await adapter.listProcesses({ sort_by: "cpu" });
      const percents = result.structured_output.processes.map((p) => p.cpu_percent);
      for (let i = 1; i < percents.length; i++) {
        expect(percents[i - 1]!).toBeGreaterThanOrEqual(percents[i]!);
      }
    });

    it("sorts by memory", async () => {
      const result = await adapter.listProcesses({ sort_by: "memory" });
      const mems = result.structured_output.processes.map((p) => p.memory_mb);
      for (let i = 1; i < mems.length; i++) {
        expect(mems[i - 1]!).toBeGreaterThanOrEqual(mems[i]!);
      }
    });

    it("sorts by name alphabetically", async () => {
      const result = await adapter.listProcesses({ sort_by: "name" });
      const names = result.structured_output.processes.map((p) => p.name);
      for (let i = 1; i < names.length; i++) {
        expect(names[i - 1]!.localeCompare(names[i]!)).toBeLessThanOrEqual(0);
      }
    });

    it("limits results with top_n", async () => {
      const result = await adapter.listProcesses({ top_n: 2 });
      expect(result.structured_output.processes.length).toBeLessThanOrEqual(2);
    });

    it("filters by name_contains", async () => {
      const result = await adapter.listProcesses({ name_contains: "chrome" });
      expect(result.structured_output.processes.every((p) =>
        p.name.toLowerCase().includes("chrome")
      )).toBe(true);
    });

    it("process entry has correct shape", async () => {
      const result = await adapter.listProcesses({ top_n: 1 });
      expect(result.structured_output.processes[0]).toMatchObject({
        pid: expect.any(Number),
        name: expect.any(String),
        cpu_percent: expect.any(Number),
        memory_mb: expect.any(Number),
        status: expect.any(String)
      });
    });
  });

  describe("killProcess", () => {
    it("kills by PID and records it", async () => {
      const result = await adapter.killProcess({ pid: 1234 });
      expect(result.structured_output.killed).toBe(true);
      expect(result.structured_output.pid).toBe(1234);
      expect(adapter.getKilledPids()).toContain(1234);
    });

    it("kills by name and records it", async () => {
      const result = await adapter.killProcess({ name: "chrome.exe" });
      expect(result.structured_output.killed).toBe(true);
      expect(result.structured_output.name).toBe("chrome.exe");
      expect(adapter.getKilledNames()).toContain("chrome.exe");
    });

    it("uses SIGKILL when force is true", async () => {
      const result = await adapter.killProcess({ pid: 999, force: true });
      expect(result.structured_output.signal).toBe("SIGKILL");
    });

    it("uses SIGTERM when force is false", async () => {
      const result = await adapter.killProcess({ pid: 999, force: false });
      expect(result.structured_output.signal).toBe("SIGTERM");
    });

    it("throws TypeError when neither pid nor name is provided", async () => {
      await expect(adapter.killProcess({})).rejects.toThrow(TypeError);
    });
  });

  describe("hardwareInfo", () => {
    it("returns full hardware info by default", async () => {
      const result = await adapter.hardwareInfo({});
      expect(result.structured_output.platform).toBe("win32");
      expect(result.structured_output.hostname).toBe("jarvis-workstation");
      expect(result.structured_output.cpu).toBeDefined();
      expect(result.structured_output.memory).toBeDefined();
      expect(result.structured_output.disks).toBeDefined();
    });

    it("respects component filter", async () => {
      const result = await adapter.hardwareInfo({ components: ["cpu", "memory"] });
      expect(result.structured_output.cpu).toBeDefined();
      expect(result.structured_output.memory).toBeDefined();
      expect(result.structured_output.gpus).toBeUndefined();
      expect(result.structured_output.disks).toBeUndefined();
    });

    it("cpu info has correct shape", async () => {
      const result = await adapter.hardwareInfo({ components: ["cpu"] });
      expect(result.structured_output.cpu).toMatchObject({
        brand: expect.any(String),
        architecture: expect.any(String),
        physical_cores: expect.any(Number),
        logical_cores: expect.any(Number)
      });
    });

    it("memory info includes total_mb", async () => {
      const result = await adapter.hardwareInfo({ components: ["memory"] });
      expect(result.structured_output.memory!.total_mb).toBeGreaterThan(0);
    });
  });
});

describe("executeSystemJob", () => {
  let adapter: MockSystemAdapter;

  beforeEach(() => {
    resetJarvisState();
    adapter = new MockSystemAdapter();
  });

  it("produces a completed JobResult for system.monitor_cpu", async () => {
    const envelope = makeEnvelope("system.monitor_cpu", { per_core: false });
    const result = await executeSystemJob(envelope, adapter);

    expect(result.contract_version).toBe(CONTRACT_VERSION);
    expect(result.job_id).toBe(envelope.job_id);
    expect(result.job_type).toBe("system.monitor_cpu");
    expect(result.status).toBe("completed");
    expect(result.attempt).toBe(1);
    expect(result.summary).toContain("42%");
    expect((result.structured_output as Record<string, unknown>).overall_percent).toBe(42);
    expect(result.metrics?.worker_id).toBe("system-worker");
    expect(result.metrics?.started_at).toBeTruthy();
    expect(result.metrics?.finished_at).toBeTruthy();
  });

  it("produces a completed JobResult for system.monitor_memory", async () => {
    const envelope = makeEnvelope("system.monitor_memory", { top_n: 3 });
    const result = await executeSystemJob(envelope, adapter);

    expect(result.status).toBe("completed");
    expect(result.job_type).toBe("system.monitor_memory");
    const out = result.structured_output as Record<string, unknown>;
    expect(out.total_mb).toBe(16384);
    expect(out.percent_used).toBe(56.2);
  });

  it("produces a completed JobResult for system.monitor_disk", async () => {
    const envelope = makeEnvelope("system.monitor_disk", {});
    const result = await executeSystemJob(envelope, adapter);

    expect(result.status).toBe("completed");
    expect(result.job_type).toBe("system.monitor_disk");
    const out = result.structured_output as Record<string, unknown>;
    expect(Array.isArray(out.volumes)).toBe(true);
    expect((out.volumes as unknown[]).length).toBe(2);
  });

  it("produces a completed JobResult for system.monitor_network", async () => {
    const envelope = makeEnvelope("system.monitor_network", {});
    const result = await executeSystemJob(envelope, adapter);

    expect(result.status).toBe("completed");
    expect(result.job_type).toBe("system.monitor_network");
    const out = result.structured_output as Record<string, unknown>;
    expect(Array.isArray(out.interfaces)).toBe(true);
  });

  it("produces a completed JobResult for system.monitor_battery", async () => {
    const envelope = makeEnvelope("system.monitor_battery", {});
    const result = await executeSystemJob(envelope, adapter);

    expect(result.status).toBe("completed");
    expect(result.job_type).toBe("system.monitor_battery");
    const out = result.structured_output as Record<string, unknown>;
    expect(out.present).toBe(true);
    expect(out.percent).toBe(78);
  });

  it("produces a completed JobResult for system.list_processes", async () => {
    const envelope = makeEnvelope("system.list_processes", { sort_by: "cpu", top_n: 3 });
    const result = await executeSystemJob(envelope, adapter);

    expect(result.status).toBe("completed");
    expect(result.job_type).toBe("system.list_processes");
    const out = result.structured_output as Record<string, unknown>;
    expect(typeof out.total_count).toBe("number");
    expect(Array.isArray(out.processes)).toBe(true);
  });

  it("produces a completed JobResult for system.kill_process", async () => {
    const envelope = makeEnvelope("system.kill_process", { pid: 1234, force: false });
    const result = await executeSystemJob(envelope, adapter);

    expect(result.status).toBe("completed");
    expect(result.job_type).toBe("system.kill_process");
    const out = result.structured_output as Record<string, unknown>;
    expect(out.killed).toBe(true);
    expect(out.pid).toBe(1234);
    expect(adapter.getKilledPids()).toContain(1234);
  });

  it("produces a completed JobResult for system.hardware_info", async () => {
    const envelope = makeEnvelope("system.hardware_info", {
      components: ["cpu", "memory"]
    });
    const result = await executeSystemJob(envelope, adapter);

    expect(result.status).toBe("completed");
    expect(result.job_type).toBe("system.hardware_info");
    const out = result.structured_output as Record<string, unknown>;
    expect(out.platform).toBe("win32");
    expect(out.cpu).toBeDefined();
    expect(out.memory).toBeDefined();
  });

  it("returns failed status for unsupported job type", async () => {
    const envelope = makeEnvelope("device.snapshot", {});
    const result = await executeSystemJob(envelope, adapter);

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("INVALID_INPUT");
    expect(result.error?.message).toContain("device.snapshot");
    expect(result.error?.retryable).toBe(false);
  });

  it("wraps TypeError from adapter into INVALID_INPUT error", async () => {
    // Build an adapter that throws a TypeError from within killProcess
    const faultyAdapter = new MockSystemAdapter();
    faultyAdapter.killProcess = async (_input) => {
      // Simulate a TypeError caused by unexpected null access
      const obj = null as unknown as { pid: number };
      void obj.pid; // throws TypeError: Cannot read properties of null
      throw new Error("unreachable");
    };

    const envelope = makeEnvelope("system.kill_process", { pid: 1 });
    const result = await executeSystemJob(envelope, faultyAdapter);

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("INVALID_INPUT");
    expect(result.error?.message).toContain("system.kill_process");
  });

  it("wraps generic Error from adapter into INTERNAL_ERROR", async () => {
    const faultyAdapter: MockSystemAdapter = new MockSystemAdapter();
    (faultyAdapter as unknown as { monitorCpu: unknown }).monitorCpu = async () => {
      throw new Error("Something went wrong");
    };

    const envelope = makeEnvelope("system.monitor_cpu", { per_core: false });
    const result = await executeSystemJob(envelope, faultyAdapter);

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("INTERNAL_ERROR");
    expect(result.error?.message).toBe("Something went wrong");
  });

  it("uses custom workerId when provided", async () => {
    const envelope = makeEnvelope("system.monitor_battery", {});
    const result = await executeSystemJob(envelope, adapter, {
      workerId: "custom-system-worker"
    });

    expect(result.status).toBe("completed");
    expect(result.metrics?.worker_id).toBe("custom-system-worker");
  });
});

describe("createSystemWorker", () => {
  beforeEach(() => {
    resetJarvisState();
  });

  it("exposes a default workerId", () => {
    const worker = createSystemWorker({ adapter: createMockSystemAdapter() });
    expect(worker.workerId).toBe("system-worker");
  });

  it("uses the provided workerId", () => {
    const worker = createSystemWorker({
      adapter: createMockSystemAdapter(),
      workerId: "my-system-worker"
    });
    expect(worker.workerId).toBe("my-system-worker");
  });

  it("executes a job via the worker facade", async () => {
    const worker = createSystemWorker({ adapter: createMockSystemAdapter() });
    const envelope = makeEnvelope("system.monitor_cpu", { per_core: true });
    const result = await worker.execute(envelope);

    expect(result.status).toBe("completed");
    expect(result.metrics?.worker_id).toBe("system-worker");
    const out = result.structured_output as Record<string, unknown>;
    expect(Array.isArray(out.cores)).toBe(true);
  });
});
