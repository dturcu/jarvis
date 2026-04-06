import os from "node:os";
import { execSync } from "node:child_process";
import {
  SystemWorkerError,
  type ExecutionOutcome,
  type SystemAdapter
} from "./adapter.js";
import type {
  CpuCoreUsage,
  DiskVolume,
  MemoryConsumer,
  NetworkAddress,
  NetworkInterface,
  ProcessEntry,
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

const IS_WINDOWS = process.platform === "win32";

function execSafe(cmd: string): string {
  try {
    return execSync(cmd, { encoding: "utf8", timeout: 10000 }).trim();
  } catch {
    return "";
  }
}

function bytesToMb(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 10) / 10;
}

function bytesToGb(bytes: number): number {
  return Math.round((bytes / 1024 / 1024 / 1024) * 100) / 100;
}

// ── CPU ──────────────────────────────────────────────────────────────────────

/**
 * Measure CPU usage by sampling idle time over a short interval.
 * Falls back to os.loadavg() on POSIX. On Windows uses a wmic query.
 */
function sampleCpuPercent(): number {
  if (IS_WINDOWS) {
    const raw = execSafe(
      "wmic cpu get LoadPercentage /value"
    );
    const match = raw.match(/LoadPercentage=(\d+)/i);
    if (match) {
      return parseInt(match[1]!, 10);
    }
    return 0;
  }
  // POSIX: use top in batch mode for a single iteration
  const raw = execSafe("top -bn1 | grep 'Cpu(s)'");
  const match = raw.match(/([\d.]+)\s*%?\s*id/);
  if (match) {
    return Math.round((100 - parseFloat(match[1]!)) * 10) / 10;
  }
  // Fallback: use 1-minute load average normalised by CPU count
  const loadAvg = os.loadavg()[0] ?? 0;
  const cpuCount = os.cpus().length || 1;
  return Math.min(100, Math.round((loadAvg / cpuCount) * 100 * 10) / 10);
}

function getCpuCorePercentages(): CpuCoreUsage[] {
  const cpus = os.cpus();
  return cpus.map((cpu, index) => {
    const total =
      cpu.times.user +
      cpu.times.nice +
      cpu.times.sys +
      cpu.times.idle +
      cpu.times.irq;
    const idle = cpu.times.idle;
    const percent = total > 0 ? Math.round(((total - idle) / total) * 1000) / 10 : 0;
    return { core_id: index, percent };
  });
}

// ── Disk ─────────────────────────────────────────────────────────────────────

function parseDiskWindows(targetPath?: string): DiskVolume[] {
  const raw = execSafe(
    "wmic logicaldisk get Caption,FreeSpace,Size,FileSystem /format:csv"
  );
  const lines = raw.split(/\r?\n/).filter((line) => line.trim() && !line.startsWith("Node"));
  const volumes: DiskVolume[] = [];

  for (const line of lines) {
    const parts = line.split(",");
    // CSV columns: Node, Caption, FileSystem, FreeSpace, Size
    if (parts.length < 5) continue;
    const caption = (parts[1] ?? "").trim();
    const filesystem = (parts[2] ?? "").trim();
    const freeBytes = parseInt((parts[3] ?? "0").trim(), 10) || 0;
    const totalBytes = parseInt((parts[4] ?? "0").trim(), 10) || 0;
    if (!caption || !totalBytes) continue;

    if (targetPath && !targetPath.toUpperCase().startsWith(caption.toUpperCase())) {
      continue;
    }

    const usedBytes = totalBytes - freeBytes;
    volumes.push({
      mount_point: caption,
      filesystem: filesystem || undefined,
      total_gb: bytesToGb(totalBytes),
      used_gb: bytesToGb(usedBytes),
      free_gb: bytesToGb(freeBytes),
      percent_used:
        totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 1000) / 10 : 0
    });
  }

  return volumes;
}

function parseDiskPosix(targetPath?: string): DiskVolume[] {
  const arg = targetPath ? ` "${targetPath}"` : "";
  const raw = execSafe(`df -Pk${arg}`);
  const lines = raw.split(/\n/).slice(1).filter(Boolean);
  const volumes: DiskVolume[] = [];

  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 6) continue;
    const [device, totalKb, usedKb, freeKb, , mountPoint] = parts as [
      string,
      string,
      string,
      string,
      string,
      string
    ];
    const total = parseInt(totalKb, 10) * 1024;
    const used = parseInt(usedKb, 10) * 1024;
    const free = parseInt(freeKb, 10) * 1024;
    volumes.push({
      mount_point: mountPoint,
      device: device !== "none" ? device : undefined,
      total_gb: bytesToGb(total),
      used_gb: bytesToGb(used),
      free_gb: bytesToGb(free),
      percent_used: total > 0 ? Math.round((used / total) * 1000) / 10 : 0
    });
  }

  return volumes;
}

// ── Processes ────────────────────────────────────────────────────────────────

function parseProcessesWindows(
  input: SystemListProcessesInput,
): ProcessEntry[] {
  const raw = execSafe("tasklist /FO CSV /V /NH");
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const processes: ProcessEntry[] = [];

  for (const line of lines) {
    // CSV: "Image Name","PID","Session Name","Session#","Mem Usage","Status","User Name","CPU Time","Window Title"
    const match = line.match(/^"([^"]+)","(\d+)","[^"]*","[^"]*","([^"]+)","([^"]+)","([^"]*)"/);
    if (!match) continue;
    const name = match[1]!;
    const pid = parseInt(match[2]!, 10);
    const memStr = match[3]!.replace(/[^\d]/g, "");
    const status = match[4]!;
    const user = match[5]!;
    const memKb = parseInt(memStr, 10) || 0;

    if (
      input.name_contains &&
      !name.toLowerCase().includes(input.name_contains.toLowerCase())
    ) {
      continue;
    }

    processes.push({
      pid,
      name,
      cpu_percent: 0,
      memory_mb: Math.round(memKb / 1024),
      status: status.toLowerCase(),
      user: user || undefined
    });
  }

  return sortAndLimit(processes, input);
}

function parseProcessesPosix(
  input: SystemListProcessesInput,
): ProcessEntry[] {
  const raw = execSafe("ps aux --no-headers");
  const lines = raw.split(/\n/).filter(Boolean);
  const processes: ProcessEntry[] = [];

  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 11) continue;
    const user = parts[0]!;
    const pid = parseInt(parts[1]!, 10);
    const cpuPercent = parseFloat(parts[2]!) || 0;
    const memPercent = parseFloat(parts[3]!) || 0;
    const command = parts.slice(10).join(" ");
    const name = (parts[10] ?? "").split("/").at(-1) ?? "";

    if (
      input.name_contains &&
      !name.toLowerCase().includes(input.name_contains.toLowerCase())
    ) {
      continue;
    }

    const totalMem = os.totalmem();
    const memMb = bytesToMb((memPercent / 100) * totalMem);

    processes.push({
      pid,
      name,
      cpu_percent: cpuPercent,
      memory_mb: memMb,
      status: "running",
      user,
      command
    });
  }

  return sortAndLimit(processes, input);
}

function sortAndLimit(
  processes: ProcessEntry[],
  input: SystemListProcessesInput,
): ProcessEntry[] {
  const sortBy = input.sort_by ?? "cpu";
  let sorted: ProcessEntry[];

  if (sortBy === "cpu") {
    sorted = [...processes].sort((a, b) => b.cpu_percent - a.cpu_percent);
  } else if (sortBy === "memory") {
    sorted = [...processes].sort((a, b) => b.memory_mb - a.memory_mb);
  } else {
    sorted = [...processes].sort((a, b) => a.name.localeCompare(b.name));
  }

  if (input.top_n && input.top_n > 0) {
    return sorted.slice(0, input.top_n);
  }

  return sorted;
}

// ── Hardware Info Helpers ─────────────────────────────────────────────────────

function getGpuInfoWindows(): Array<{ name: string; vram_mb?: number; driver_version?: string }> {
  const raw = execSafe(
    "powershell -NoProfile -Command \"Get-WmiObject Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion | ConvertTo-Json -Compress\""
  );
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    const entries = Array.isArray(parsed) ? parsed : [parsed];
    return entries
      .filter((entry): entry is Record<string, unknown> => entry != null && typeof entry === "object")
      .map((entry) => ({
        name: String(entry["Name"] ?? "Unknown GPU"),
        vram_mb: typeof entry["AdapterRAM"] === "number"
          ? bytesToMb(entry["AdapterRAM"] as number)
          : undefined,
        driver_version: typeof entry["DriverVersion"] === "string"
          ? (entry["DriverVersion"] as string)
          : undefined
      }));
  } catch {
    return [];
  }
}

function getBatteryInfoWindows() {
  const raw = execSafe(
    "powershell -NoProfile -Command \"Get-WmiObject Win32_Battery | Select-Object EstimatedChargeRemaining,BatteryStatus,EstimatedRunTime,DesignCapacity | ConvertTo-Json -Compress\""
  );
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const charge = typeof parsed["EstimatedChargeRemaining"] === "number"
      ? parsed["EstimatedChargeRemaining"] as number
      : undefined;
    const batteryStatus = typeof parsed["BatteryStatus"] === "number"
      ? parsed["BatteryStatus"] as number
      : undefined;
    const runTime = typeof parsed["EstimatedRunTime"] === "number"
      ? parsed["EstimatedRunTime"] as number
      : undefined;

    // BatteryStatus: 1=Discharging, 2=AC Online, 3=Fully Charged, etc.
    let status: "charging" | "discharging" | "full" | "unknown" = "unknown";
    if (batteryStatus === 2) status = "charging";
    else if (batteryStatus === 3) status = "full";
    else if (batteryStatus === 1) status = "discharging";

    return {
      present: true,
      percent: charge,
      status,
      time_remaining_seconds:
        runTime != null && runTime < 71582788 ? runTime * 60 : undefined
    };
  } catch {
    return null;
  }
}

export class NodeSystemAdapter implements SystemAdapter {
  async monitorCpu(
    input: SystemMonitorCpuInput,
  ): Promise<ExecutionOutcome<SystemMonitorCpuOutput>> {
    const overallPercent = sampleCpuPercent();
    const cores = input.per_core ? getCpuCorePercentages() : undefined;
    const [one, five, fifteen] = os.loadavg();

    const structured_output: SystemMonitorCpuOutput = {
      overall_percent: overallPercent,
      cores,
      load_averages: IS_WINDOWS
        ? undefined
        : { one: one!, five: five!, fifteen: fifteen! }
    };

    const coresSummary = input.per_core && cores
      ? ` (${cores.length} cores reported)`
      : "";
    return {
      summary: `CPU usage is ${overallPercent}% overall${coresSummary}.`,
      structured_output
    };
  }

  async monitorMemory(
    input: SystemMonitorMemoryInput,
  ): Promise<ExecutionOutcome<SystemMonitorMemoryOutput>> {
    const totalBytes = os.totalmem();
    const freeBytes = os.freemem();
    const usedBytes = totalBytes - freeBytes;
    const totalMb = bytesToMb(totalBytes);
    const freeMb = bytesToMb(freeBytes);
    const usedMb = bytesToMb(usedBytes);
    const percentUsed = Math.round((usedBytes / totalBytes) * 1000) / 10;

    let topConsumers: MemoryConsumer[] | undefined;

    if (input.top_n && input.top_n > 0) {
      const processes = IS_WINDOWS
        ? parseProcessesWindows({ sort_by: "memory", top_n: input.top_n })
        : parseProcessesPosix({ sort_by: "memory", top_n: input.top_n });

      topConsumers = processes.map((p) => ({
        pid: p.pid,
        name: p.name,
        memory_mb: p.memory_mb,
        percent: Math.round((p.memory_mb / totalMb) * 1000) / 10
      }));
    }

    return {
      summary: `Memory usage: ${usedMb} MB used of ${totalMb} MB total (${percentUsed}%).`,
      structured_output: {
        total_mb: totalMb,
        used_mb: usedMb,
        free_mb: freeMb,
        available_mb: freeMb,
        percent_used: percentUsed,
        top_consumers: topConsumers
      }
    };
  }

  async monitorDisk(
    input: SystemMonitorDiskInput,
  ): Promise<ExecutionOutcome<SystemMonitorDiskOutput>> {
    const volumes = IS_WINDOWS
      ? parseDiskWindows(input.path)
      : parseDiskPosix(input.path);

    if (volumes.length === 0) {
      throw new SystemWorkerError(
        "DISK_NOT_FOUND",
        input.path
          ? `No disk volume found at path: ${input.path}`
          : "No disk volumes could be enumerated."
      );
    }

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
    const rawInterfaces = os.networkInterfaces();
    const interfaces: NetworkInterface[] = [];

    for (const [ifName, addrs] of Object.entries(rawInterfaces)) {
      if (!addrs || addrs.length === 0) continue;
      if (
        input.interface_name &&
        !ifName.toLowerCase().includes(input.interface_name.toLowerCase())
      ) {
        continue;
      }

      const addresses: NetworkAddress[] = addrs.map((addr) => ({
        family: addr.family as "IPv4" | "IPv6",
        address: addr.address,
        netmask: addr.netmask,
        mac: undefined
      }));

      // Enrich with MAC via first entry's mac property
      const macAddr = (addrs[0] as { mac?: string }).mac;
      if (macAddr && macAddr !== "00:00:00:00:00:00") {
        addresses.push({ family: "MAC", address: macAddr });
      }

      interfaces.push({ name: ifName, addresses });
    }

    const summary =
      input.interface_name
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
    if (IS_WINDOWS) {
      const battery = getBatteryInfoWindows();
      if (!battery) {
        return {
          summary: "No battery detected.",
          structured_output: { present: false }
        };
      }
      const pct = battery.percent != null ? ` at ${battery.percent}%` : "";
      return {
        summary: `Battery present${pct}, status: ${battery.status}.`,
        structured_output: battery
      };
    }

    // POSIX: try upower
    const raw = execSafe("upower -i $(upower -e | grep battery) 2>/dev/null");
    if (!raw) {
      return {
        summary: "No battery detected.",
        structured_output: { present: false }
      };
    }

    const percentMatch = raw.match(/percentage:\s*([\d.]+)%/i);
    const stateMatch = raw.match(/state:\s*(\S+)/i);

    const percent = percentMatch ? parseFloat(percentMatch[1]!) : undefined;
    const rawState = stateMatch?.[1]?.toLowerCase();
    let status: SystemMonitorBatteryOutput["status"] = "unknown";
    if (rawState === "charging") status = "charging";
    else if (rawState === "discharging") status = "discharging";
    else if (rawState === "fully-charged") status = "full";

    const pct = percent != null ? ` at ${percent}%` : "";
    return {
      summary: `Battery present${pct}, status: ${status}.`,
      structured_output: { present: true, percent, status }
    };
  }

  async listProcesses(
    input: SystemListProcessesInput,
  ): Promise<ExecutionOutcome<SystemListProcessesOutput>> {
    const processes = IS_WINDOWS
      ? parseProcessesWindows(input)
      : parseProcessesPosix(input);

    const filterSuffix = input.name_contains
      ? ` matching '${input.name_contains}'`
      : "";
    const limitSuffix = input.top_n ? ` (top ${input.top_n})` : "";

    return {
      summary: `Found ${processes.length} process(es)${filterSuffix}${limitSuffix}.`,
      structured_output: {
        total_count: processes.length,
        processes
      }
    };
  }

  async killProcess(
    input: SystemKillProcessInput,
  ): Promise<ExecutionOutcome<SystemKillProcessOutput>> {
    if (!input.pid && !input.name) {
      throw new SystemWorkerError(
        "INVALID_INPUT",
        "Either pid or name must be provided to kill a process."
      );
    }

    if (IS_WINDOWS) {
      return this.killProcessWindows(input);
    }
    return this.killProcessPosix(input);
  }

  private killProcessWindows(
    input: SystemKillProcessInput,
  ): ExecutionOutcome<SystemKillProcessOutput> {
    const forceFlag = input.force ? " /F" : "";

    if (input.pid) {
      execSync(`taskkill /PID ${input.pid}${forceFlag}`, { stdio: "ignore" });
      return {
        summary: `Killed process with PID ${input.pid}.`,
        structured_output: {
          killed: true,
          pid: input.pid,
          signal: input.force ? "SIGKILL" : "SIGTERM"
        }
      };
    }

    execSync(`taskkill /IM "${input.name}"${forceFlag}`, { stdio: "ignore" });
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

  private killProcessPosix(
    input: SystemKillProcessInput,
  ): ExecutionOutcome<SystemKillProcessOutput> {
    if (input.pid) {
      process.kill(input.pid, input.force ? "SIGKILL" : "SIGTERM");
      return {
        summary: `Sent ${input.force ? "SIGKILL" : "SIGTERM"} to PID ${input.pid}.`,
        structured_output: {
          killed: true,
          pid: input.pid,
          signal: input.force ? "SIGKILL" : "SIGTERM"
        }
      };
    }

    const signal = input.force ? "-9" : "-15";
    execSync(`pkill ${signal} -f "${input.name}"`, { stdio: "ignore" });
    return {
      summary: `Sent signal to process(es) named '${input.name}'.`,
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
      platform: process.platform,
      hostname: os.hostname()
    };

    // OS version
    output.os_version = `${os.type()} ${os.release()}`;

    // CPU
    if (want.has("cpu")) {
      const cpus = os.cpus();
      if (cpus.length > 0) {
        const first = cpus[0]!;
        output.cpu = {
          brand: first.model,
          architecture: process.arch,
          physical_cores: Math.ceil(cpus.length / 2),
          logical_cores: cpus.length,
          base_frequency_mhz: first.speed
        };
      }
    }

    // GPU (Windows only)
    if (want.has("gpu") && IS_WINDOWS) {
      const gpus = getGpuInfoWindows();
      if (gpus.length > 0) {
        output.gpus = gpus;
      }
    }

    // Memory
    if (want.has("memory")) {
      output.memory = {
        total_mb: bytesToMb(os.totalmem())
      };
    }

    // Disk
    if (want.has("disk")) {
      const volumes = IS_WINDOWS ? parseDiskWindows() : parseDiskPosix();
      if (volumes.length > 0) {
        output.disks = volumes.map((v) => ({
          device: v.device ?? v.mount_point,
          model: undefined,
          size_gb: v.total_gb,
          type: "Unknown" as const
        }));
      }
    }

    // Network
    if (want.has("network")) {
      const rawInterfaces = os.networkInterfaces();
      output.network_interfaces = Object.entries(rawInterfaces)
        .filter(([, addrs]) => addrs && addrs.length > 0)
        .map(([ifName, addrs]) => {
          const macAddr = (addrs?.[0] as { mac?: string })?.mac;
          return {
            name: ifName,
            mac_address:
              macAddr && macAddr !== "00:00:00:00:00:00" ? macAddr : undefined
          };
        });
    }

    // Battery
    if (want.has("battery") && IS_WINDOWS) {
      const battery = getBatteryInfoWindows();
      output.battery = battery
        ? {
            present: true,
            model: undefined,
            capacity_mwh: undefined
          }
        : { present: false };
    }

    const componentList = components.join(", ");
    return {
      summary: `Hardware info collected for: ${componentList}.`,
      structured_output: output
    };
  }
}

export function createNodeSystemAdapter(): SystemAdapter {
  return new NodeSystemAdapter();
}
