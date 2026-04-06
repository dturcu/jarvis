// ── CPU ──────────────────────────────────────────────────────────────────────

export type SystemMonitorCpuInput = {
  per_core: boolean;
};

export type CpuCoreUsage = {
  core_id: number;
  percent: number;
};

export type SystemMonitorCpuOutput = {
  overall_percent: number;
  cores?: CpuCoreUsage[];
  load_averages?: {
    one: number;
    five: number;
    fifteen: number;
  };
};

// ── Memory ───────────────────────────────────────────────────────────────────

export type SystemMonitorMemoryInput = {
  top_n?: number;
};

export type MemoryConsumer = {
  pid: number;
  name: string;
  memory_mb: number;
  percent: number;
};

export type SystemMonitorMemoryOutput = {
  total_mb: number;
  used_mb: number;
  free_mb: number;
  available_mb: number;
  percent_used: number;
  swap_total_mb?: number;
  swap_used_mb?: number;
  swap_free_mb?: number;
  top_consumers?: MemoryConsumer[];
};

// ── Disk ─────────────────────────────────────────────────────────────────────

export type SystemMonitorDiskInput = {
  path?: string;
};

export type DiskVolume = {
  mount_point: string;
  device?: string;
  filesystem?: string;
  total_gb: number;
  used_gb: number;
  free_gb: number;
  percent_used: number;
};

export type SystemMonitorDiskOutput = {
  volumes: DiskVolume[];
};

// ── Network ──────────────────────────────────────────────────────────────────

export type SystemMonitorNetworkInput = {
  interface_name?: string;
};

export type NetworkAddress = {
  family: "IPv4" | "IPv6" | "MAC";
  address: string;
  netmask?: string;
  broadcast?: string;
};

export type NetworkInterface = {
  name: string;
  addresses: NetworkAddress[];
  bytes_sent?: number;
  bytes_recv?: number;
  packets_sent?: number;
  packets_recv?: number;
  is_up?: boolean;
};

export type SystemMonitorNetworkOutput = {
  interfaces: NetworkInterface[];
};

// ── Battery ───────────────────────────────────────────────────────────────────

export type SystemMonitorBatteryOutput = {
  present: boolean;
  percent?: number;
  status?: "charging" | "discharging" | "full" | "unknown";
  time_remaining_seconds?: number;
  voltage_mv?: number;
};

// ── Processes ────────────────────────────────────────────────────────────────

export type SystemListProcessesInput = {
  sort_by?: "cpu" | "memory" | "name";
  top_n?: number;
  name_contains?: string;
};

export type ProcessEntry = {
  pid: number;
  name: string;
  cpu_percent: number;
  memory_mb: number;
  status: string;
  user?: string;
  command?: string;
};

export type SystemListProcessesOutput = {
  total_count: number;
  processes: ProcessEntry[];
};

// ── Kill Process ─────────────────────────────────────────────────────────────

export type SystemKillProcessInput = {
  pid?: number;
  name?: string;
  force?: boolean;
};

export type SystemKillProcessOutput = {
  killed: boolean;
  pid: number;
  name?: string;
  signal?: string;
};

// ── Hardware Info ─────────────────────────────────────────────────────────────

export type SystemHardwareInfoInput = {
  components?: Array<"cpu" | "gpu" | "memory" | "disk" | "network" | "display" | "battery">;
};

export type CpuHardwareInfo = {
  brand: string;
  architecture: string;
  physical_cores: number;
  logical_cores: number;
  base_frequency_mhz?: number;
  max_frequency_mhz?: number;
  cache_sizes?: {
    l1?: number;
    l2?: number;
    l3?: number;
  };
};

export type GpuHardwareInfo = {
  name: string;
  vram_mb?: number;
  driver_version?: string;
};

export type MemoryHardwareInfo = {
  total_mb: number;
  slots?: Array<{
    slot_id: string;
    size_mb: number;
    speed_mhz?: number;
    manufacturer?: string;
  }>;
};

export type DiskHardwareInfo = {
  device: string;
  model?: string;
  size_gb: number;
  type?: "HDD" | "SSD" | "NVMe" | "Unknown";
  interface?: string;
};

export type NetworkHardwareInfo = {
  name: string;
  mac_address?: string;
  speed_mbps?: number;
  type?: string;
};

export type DisplayHardwareInfo = {
  name: string;
  width: number;
  height: number;
  refresh_rate_hz?: number;
  is_primary: boolean;
};

export type BatteryHardwareInfo = {
  present: boolean;
  model?: string;
  capacity_mwh?: number;
  design_capacity_mwh?: number;
  cycle_count?: number;
  manufacturer?: string;
};

export type SystemHardwareInfoOutput = {
  platform: string;
  hostname: string;
  os_version?: string;
  cpu?: CpuHardwareInfo;
  gpus?: GpuHardwareInfo[];
  memory?: MemoryHardwareInfo;
  disks?: DiskHardwareInfo[];
  network_interfaces?: NetworkHardwareInfo[];
  displays?: DisplayHardwareInfo[];
  battery?: BatteryHardwareInfo;
};
