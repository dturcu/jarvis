import type { ExecutionOutcome } from "./adapter.js";
import { DesktopHostError } from "./adapter.js";

type PowerShellRunner = (script: string) => Promise<string>;

export type NetworkInterfaceRef = {
  interface_name: string;
  description?: string;
  status: "up" | "down" | "unknown";
  ip_address?: string;
  mac_address?: string;
  ssid?: string;
  signal_strength_dbm?: number;
  is_wifi?: boolean;
  is_vpn?: boolean;
};

export type NetworkStatusInput = {
  interface_name?: string;
};

export type NetworkStatusOutput = {
  interfaces: NetworkInterfaceRef[];
  internet_reachable?: boolean;
};

export type NetworkControlAction = "connect" | "disconnect";

export type NetworkControlInput = {
  action: NetworkControlAction;
  ssid?: string;
  vpn_name?: string;
};

export type NetworkControlOutput = {
  applied: boolean;
  action: string;
  interface_name?: string;
  ssid?: string;
  vpn_name?: string;
};

export async function getNetworkStatus(
  input: NetworkStatusInput,
  run: PowerShellRunner,
): Promise<ExecutionOutcome<NetworkStatusOutput>> {
  const args = input.interface_name ? `-InterfaceName ${quotePs(input.interface_name)}` : "";
  const raw = await runJson<{ interfaces: NetworkInterfaceRef[]; internet_reachable: boolean }>(
    run,
    `Get-JarvisNetworkStatus ${args}`
  );

  const upCount = raw.interfaces.filter((iface) => iface.status === "up").length;
  return {
    summary: `Retrieved network status: ${raw.interfaces.length} interface(s), ${raw.internet_reachable ? "internet reachable" : "no internet"}.`,
    structured_output: {
      interfaces: raw.interfaces,
      internet_reachable: raw.internet_reachable
    }
  };
  void upCount;
}

export async function controlNetwork(
  input: NetworkControlInput,
  run: PowerShellRunner,
): Promise<ExecutionOutcome<NetworkControlOutput>> {
  if (input.action !== "connect" && input.action !== "disconnect") {
    throw new DesktopHostError("INVALID_INPUT", `Unsupported network action: ${String(input.action)}.`);
  }
  if (!input.ssid && !input.vpn_name) {
    throw new DesktopHostError("INVALID_INPUT", "Either ssid or vpn_name must be provided for network control.");
  }

  const args: string[] = [`-Action ${quotePs(input.action)}`];
  if (input.ssid) {
    args.push(`-Ssid ${quotePs(input.ssid)}`);
  }
  if (input.vpn_name) {
    args.push(`-VpnName ${quotePs(input.vpn_name)}`);
  }

  const raw = await runJson<{ applied: boolean; interface_name?: string }>(
    run,
    `Invoke-JarvisNetworkControl ${args.join(" ")}`
  );

  const target = input.ssid ?? input.vpn_name ?? "network";
  const actionVerb = input.action === "connect" ? "Connected to" : "Disconnected from";

  return {
    summary: `${actionVerb} ${input.ssid ? `WiFi network '${input.ssid}'` : `VPN '${input.vpn_name}'`} successfully.`,
    structured_output: {
      applied: raw.applied,
      action: input.action,
      interface_name: raw.interface_name,
      ssid: input.ssid,
      vpn_name: input.vpn_name
    }
  };
  void target;
}

async function runJson<T>(run: PowerShellRunner, body: string): Promise<T> {
  const output = await run(`${NETWORK_PRELUDE}\n${body} | ConvertTo-Json -Depth 6 -Compress`);
  if (!output.trim()) {
    throw new DesktopHostError("NETWORK_ENUMERATION_FAILED", "The network host returned no output.");
  }
  try {
    return JSON.parse(output) as T;
  } catch {
    throw new DesktopHostError("NETWORK_ENUMERATION_FAILED", "The network host returned invalid JSON.", false, { output });
  }
}

function quotePs(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

const NETWORK_PRELUDE = String.raw`
$ErrorActionPreference = "Stop"
function Get-JarvisNetworkStatus {
  param([string]$InterfaceName = "")
  $adapters = Get-NetAdapter | Where-Object { $_.Status -ne "Not Present" }
  if ($InterfaceName) {
    $adapters = $adapters | Where-Object { $_.Name -eq $InterfaceName }
    if (-not $adapters) { throw "Interface not found: $InterfaceName" }
  }
  $interfaces = $adapters | ForEach-Object {
    $adapter = $_
    $ipConfig = Get-NetIPAddress -InterfaceIndex $adapter.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue | Select-Object -First 1
    $isWifi = $adapter.MediaType -eq "802.11" -or $adapter.PhysicalMediaType -eq "Native 802.11"
    $isVpn = $adapter.InterfaceDescription -match "VPN|Virtual|TAP|TUN"
    $ssid = $null
    $signalDbm = $null
    if ($isWifi) {
      try {
        $wlanInfo = netsh wlan show interfaces 2>$null | Out-String
        if ($wlanInfo -match "SSID\s*:\s*(.+)") { $ssid = $Matches[1].Trim() }
        if ($wlanInfo -match "Signal\s*:\s*(\d+)%") { $signalDbm = [int](-100 + [int]$Matches[1] / 2) }
      } catch {}
    }
    $status = if ($adapter.Status -eq "Up") { "up" } elseif ($adapter.Status -eq "Disconnected") { "down" } else { "unknown" }
    [pscustomobject]@{
      interface_name = $adapter.Name
      description = $adapter.InterfaceDescription
      status = $status
      ip_address = if ($ipConfig) { $ipConfig.IPAddress } else { $null }
      mac_address = $adapter.MacAddress
      ssid = $ssid
      signal_strength_dbm = $signalDbm
      is_wifi = $isWifi
      is_vpn = [bool]$isVpn
    }
  }
  $reachable = $false
  try { $reachable = Test-Connection -ComputerName "8.8.8.8" -Count 1 -Quiet -TimeoutSeconds 3 } catch {}
  [pscustomobject]@{
    interfaces = @($interfaces)
    internet_reachable = $reachable
  }
}
function Invoke-JarvisNetworkControl {
  param([string]$Action, [string]$Ssid = "", [string]$VpnName = "")
  $interfaceName = $null
  if ($Ssid) {
    $wifiAdapter = Get-NetAdapter | Where-Object { $_.MediaType -eq "802.11" -or $_.PhysicalMediaType -eq "Native 802.11" } | Select-Object -First 1
    if (-not $wifiAdapter) { throw "No WiFi adapter found." }
    $interfaceName = $wifiAdapter.Name
    if ($Action -eq "connect") {
      netsh wlan connect name=$Ssid interface=$interfaceName 2>&1 | Out-Null
    } else {
      netsh wlan disconnect interface=$interfaceName 2>&1 | Out-Null
    }
  } elseif ($VpnName) {
    if ($Action -eq "connect") {
      $vpn = Get-VpnConnection -Name $VpnName -ErrorAction Stop
      rasdial $VpnName 2>&1 | Out-Null
      $interfaceName = $vpn.Name
    } else {
      rasdial $VpnName /disconnect 2>&1 | Out-Null
      $interfaceName = $VpnName
    }
  }
  [pscustomobject]@{ applied = $true; interface_name = $interfaceName }
}
`;
