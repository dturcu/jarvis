import type { ExecutionOutcome, SystemAdapter } from "./adapter.js";
import type {
  SystemHardwareInfoInput,
  SystemHardwareInfoOutput,
  SystemKillProcessInput,
  SystemKillProcessOutput,
  SystemListProcessesInput,
  SystemListProcessesOutput,
  SystemMonitorBatteryOutput,
  SystemMonitorCpuInput,
  SystemMonitorCpuOutput,
  SystemMonitorDiskInput,
  SystemMonitorDiskOutput,
  SystemMonitorMemoryInput,
  SystemMonitorMemoryOutput,
  SystemMonitorNetworkInput,
  SystemMonitorNetworkOutput
} from "./types.js";

const MOCK_PROCESSES = [
  {
    pid: 1234,
    name: "chrome.exe",
    cpu_percent: 8.2,
    memory_mb: 420,
    status: "running",
    user: "operator",
    command: "chrome.exe --type=renderer"
  },
  {
    pid: 5678,
    name: "node.exe",
    cpu_percent: 3.1,
    memory_mb: 210,
    status: "running",
    user: "operator",
    command: "node ./dist/main.js"
  },
  {
    pid: 9012,
    name: "explorer.exe",
    cpu_percent: 0.4,
    memory_mb: 95,
    status: "running",
    user: "operator",
    command: "C:\\Windows\\explorer.exe"
  },
  {
    pid: 3456,
    name: "vscode.exe",
    cpu_percent: 12.7,
    memory_mb: 380,
    status: "running",
    user: "operator",
    command: "vscode.exe --extensionDevelopmentPath"
  },
  {
    pid: 7890,
    name: "svchost.exe",
    cpu_percent: 0.1,
    memory_mb: 48,
    status: "running",
    user: "SYSTEM",
    command: "svchost.exe -k NetworkService"
  }
];

export class MockSystemAdapter implements SystemAdapter {
  private killedPids: number[] = [];
  private killedNames: string[] = [];

  getKilledPids(): number[] {
    return [...this.killedPids];
  }

  getKilledNames(): string[] {
    return [...this.killedNames];
  }

  async monitorCpu(
    input: SystemMonitorCpuInput,
  ): Promise<ExecutionOutcome<SystemMonitorCpuOutput>> {
    const overallPercent = 42;
    const cores = input.per_core
      ? [
          { core_id: 0, percent: 38 },
          { core_id: 1, percent: 46 },
          { core_id: 2, percent: 35 },
          { core_id: 3, percent: 49 }
        ]
      : undefined;

    return {
      summary: `CPU usage is ${overallPercent}% overall${input.per_core ? " (4 cores reported)" : ""}.`,
      structured_output: {
        overall_percent: overallPercent,
        cores,
        load_averages: { one: 1.2, five: 0.9, fifteen: 0.7 }
      }
    };
  }

  async monitorMemory(
    input: SystemMonitorMemoryInput,
  ): Promise<ExecutionOutcome<SystemMonitorMemoryOutput>> {
    const totalMb = 16384;
    const usedMb = 9216;
    const freeMb = 7168;
    const availableMb = 7168;
    const percentUsed = 56.2;

    const topConsumers =
      input.top_n && input.top_n > 0
        ? [
            { pid: 1234, name: "chrome.exe", memory_mb: 420, percent: 2.6 },
            { pid: 3456, name: "vscode.exe", memory_mb: 380, percent: 2.3 },
            { pid: 5678, name: "node.exe", memory_mb: 210, percent: 1.3 }
          ].slice(0, input.top_n)
        : undefined;

    return {
      summary: `Memory usage: ${usedMb} MB used of ${totalMb} MB total (${percentUsed}%).`,
      structured_output: {
        total_mb: totalMb,
        used_mb: usedMb,
        free_mb: freeMb,
        available_mb: availableMb,
        percent_used: percentUsed,
        swap_total_mb: 4096,
        swap_used_mb: 512,
        swap_free_mb: 3584,
        top_consumers: topConsumers
      }
    };
  }

  async monitorDisk(
    input: SystemMonitorDiskInput,
  ): Promise<ExecutionOutcome<SystemMonitorDiskOutput>> {
    const allVolumes = [
      {
        mount_point: "C:",
        device: "\\\\.\\PhysicalDrive0",
        filesystem: "NTFS",
        total_gb: 476.84,
        used_gb: 238.42,
        free_gb: 238.42,
        percent_used: 50.0
      },
      {
        mount_point: "D:",
        device: "\\\\.\\PhysicalDrive1",
        filesystem: "NTFS",
        total_gb: 931.51,
        used_gb: 465.76,
        free_gb: 465.75,
        percent_used: 50.0
      }
    ];

    const volumes = input.path
      ? allVolumes.filter((v) =>
          input.path!.toUpperCase().startsWith(v.mount_point.toUpperCase())
        )
      : allVolumes;

    const summary =
      volumes.length === 1
        ? `Disk ${volumes[0]!.mount_point}: ${volumes[0]!.used_gb} GB used of ${volumes[0]!.total_gb} GB (${volumes[0]!.percent_used}% full).`
        : `${volumes.length} disk volume(s) enumerated.`;

    return {
      summary,
      structured_output: { volumes }
    };
  }

  async monitorNetwork(
    input: SystemMonitorNetworkInput,
  ): Promise<ExecutionOutcome<SystemMonitorNetworkOutput>> {
    const allInterfaces = [
      {
        name: "Ethernet",
        addresses: [
          { family: "IPv4" as const, address: "192.168.1.100", netmask: "255.255.255.0" },
          { family: "MAC" as const, address: "AA:BB:CC:DD:EE:FF" }
        ],
        bytes_sent: 104857600,
        bytes_recv: 524288000,
        packets_sent: 75000,
        packets_recv: 350000,
        is_up: true
      },
      {
        name: "Loopback Pseudo-Interface 1",
        addresses: [
          { family: "IPv4" as const, address: "127.0.0.1", netmask: "255.0.0.0" },
          { family: "IPv6" as const, address: "::1" }
        ],
        is_up: true
      }
    ];

    const interfaces = input.interface_name
      ? allInterfaces.filter((iface) =>
          iface.name.toLowerCase().includes(input.interface_name!.toLowerCase())
        )
      : allInterfaces;

    const summary = input.interface_name
      ? interfaces.length > 0
        ? `Network interface ${interfaces[0]!.name} has ${interfaces[0]!.addresses.length} address(es).`
        : `No interface matching '${input.interface_name}' found.`
      : `${interfaces.length} network interface(s) found.`;

    return {
      summary,
      structured_output: { interfaces }
    };
  }

  async monitorBattery(): Promise<ExecutionOutcome<SystemMonitorBatteryOutput>> {
    return {
      summary: "Battery present at 78%, status: discharging.",
      structured_output: {
        present: true,
        percent: 78,
        status: "discharging",
        time_remaining_seconds: 7200,
        voltage_mv: 11400
      }
    };
  }

  async listProcesses(
    input: SystemListProcessesInput,
  ): Promise<ExecutionOutcome<SystemListProcessesOutput>> {
    let filtered = [...MOCK_PROCESSES];

    if (input.name_contains) {
      const needle = input.name_contains.toLowerCase();
      filtered = filtered.filter((p) => p.name.toLowerCase().includes(needle));
    }

    const sortBy = input.sort_by ?? "cpu";
    if (sortBy === "cpu") {
      filtered.sort((a, b) => b.cpu_percent - a.cpu_percent);
    } else if (sortBy === "memory") {
      filtered.sort((a, b) => b.memory_mb - a.memory_mb);
    } else {
      filtered.sort((a, b) => a.name.localeCompare(b.name));
    }

    if (input.top_n && input.top_n > 0) {
      filtered = filtered.slice(0, input.top_n);
    }

    const filterSuffix = input.name_contains
      ? ` matching '${input.name_contains}'`
      : "";
    const limitSuffix = input.top_n ? ` (top ${input.top_n})` : "";

    return {
      summary: `Found ${filtered.length} process(es)${filterSuffix}${limitSuffix}.`,
      structured_output: {
        total_count: filtered.length,
        processes: filtered
      }
    };
  }

  async killProcess(
    input: SystemKillProcessInput,
  ): Promise<ExecutionOutcome<SystemKillProcessOutput>> {
    if (!input.pid && !input.name) {
      throw new TypeError("Either pid or name must be provided to kill a process.");
    }

    if (input.pid) {
      this.killedPids.push(input.pid);
      return {
        summary: `Killed process with PID ${input.pid}.`,
        structured_output: {
          killed: true,
          pid: input.pid,
          signal: input.force ? "SIGKILL" : "SIGTERM"
        }
      };
    }

    this.killedNames.push(input.name!);
    return {
      summary: `Killed process(es) named '${input.name}'.`,
      structured_output: {
        killed: true,
        pid: 0,
        name: input.name,
        signal: input.force ? "SIGKILL" : "SIGTERM"
      }
    };
  }

  async hardwareInfo(
    input: SystemHardwareInfoInput,
  ): Promise<ExecutionOutcome<SystemHardwareInfoOutput>> {
    const components = input.components ?? [
      "cpu",
      "gpu",
      "memory",
      "disk",
      "network",
      "display",
      "battery"
    ];
    const want = new Set(components);

    const output: SystemHardwareInfoOutput = {
      platform: "win32",
      hostname: "jarvis-workstation",
      os_version: "Windows 11 Pro 10.0.26200"
    };

    if (want.has("cpu")) {
      output.cpu = {
        brand: "AMD Ryzen 9 5900X",
        architecture: "x64",
        physical_cores: 12,
        logical_cores: 24,
        base_frequency_mhz: 3700,
        max_frequency_mhz: 4800,
        cache_sizes: {
          l1: 768,
          l2: 6144,
          l3: 65536
        }
      };
    }

    if (want.has("gpu")) {
      output.gpus = [
        {
          name: "NVIDIA GeForce RTX 3080",
          vram_mb: 10240,
          driver_version: "546.33"
        }
      ];
    }

    if (want.has("memory")) {
      output.memory = {
        total_mb: 32768,
        slots: [
          { slot_id: "DIMM_A1", size_mb: 16384, speed_mhz: 3600, manufacturer: "G.Skill" },
          { slot_id: "DIMM_B1", size_mb: 16384, speed_mhz: 3600, manufacturer: "G.Skill" }
        ]
      };
    }

    if (want.has("disk")) {
      output.disks = [
        { device: "\\\\.\\PhysicalDrive0", model: "Samsung 980 Pro 512GB", size_gb: 476.84, type: "NVMe" },
        { device: "\\\\.\\PhysicalDrive1", model: "WD Blue 1TB", size_gb: 931.51, type: "HDD" }
      ];
    }

    if (want.has("network")) {
      output.network_interfaces = [
        { name: "Ethernet", mac_address: "AA:BB:CC:DD:EE:FF", speed_mbps: 1000, type: "Ethernet" },
        { name: "Wi-Fi", mac_address: "11:22:33:44:55:66", speed_mbps: 300, type: "802.11ac" }
      ];
    }

    if (want.has("display")) {
      output.displays = [
        { name: "ASUS ROG Swift 32\"", width: 2560, height: 1440, refresh_rate_hz: 165, is_primary: true },
        { name: "Dell UltraSharp 27\"", width: 2560, height: 1440, refresh_rate_hz: 60, is_primary: false }
      ];
    }

    if (want.has("battery")) {
      output.battery = {
        present: false
      };
    }

    const componentList = components.join(", ");
    return {
      summary: `Hardware info collected for: ${componentList}.`,
      structured_output: output
    };
  }
}

export function createMockSystemAdapter(): SystemAdapter {
  return new MockSystemAdapter();
}
