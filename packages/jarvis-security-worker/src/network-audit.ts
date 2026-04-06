import type { PowerShellRunner } from "./process-monitor.js";

export type NetworkConnection = {
  localAddress: string;
  localPort: number;
  remoteAddress: string;
  remotePort: number;
  state: string;
  processName?: string;
  pid?: number;
};

const SUSPICIOUS_REMOTE_PORTS = new Set([4444, 4445, 1337, 31337, 6666, 7777, 9999]);
const SUSPICIOUS_STATES = new Set(["CLOSE_WAIT", "FIN_WAIT_1", "FIN_WAIT_2"]);

/**
 * Audits network connections using a PowerShell runner.
 * Returns structured NetworkConnection entries.
 */
export async function auditConnections(runner: PowerShellRunner): Promise<NetworkConnection[]> {
  const script = `
Get-NetTCPConnection | Select-Object -Property LocalAddress, LocalPort, RemoteAddress, RemotePort, State, OwningProcess |
  ForEach-Object {
    $proc = $null
    try { $proc = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue } catch {}
    [PSCustomObject]@{
      localAddress = $_.LocalAddress
      localPort = $_.LocalPort
      remoteAddress = $_.RemoteAddress
      remotePort = $_.RemotePort
      state = $_.State.ToString()
      processName = if ($proc) { $proc.ProcessName } else { $null }
      pid = $_.OwningProcess
    }
  } | ConvertTo-Json -Depth 2
`.trim();

  const raw = await runner.run(script);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  const items = Array.isArray(parsed) ? parsed : [parsed];
  return items
    .filter((item): item is Record<string, unknown> => item !== null && typeof item === "object")
    .map((item) => ({
      localAddress: typeof item["localAddress"] === "string" ? item["localAddress"] : "0.0.0.0",
      localPort: typeof item["localPort"] === "number" ? item["localPort"] : 0,
      remoteAddress: typeof item["remoteAddress"] === "string" ? item["remoteAddress"] : "0.0.0.0",
      remotePort: typeof item["remotePort"] === "number" ? item["remotePort"] : 0,
      state: typeof item["state"] === "string" ? item["state"] : "UNKNOWN",
      processName: typeof item["processName"] === "string" ? item["processName"] : undefined,
      pid: typeof item["pid"] === "number" ? item["pid"] : undefined
    }));
}

/**
 * Identifies whether a network connection is suspicious.
 */
export function isSuspiciousConnection(conn: NetworkConnection): { suspicious: boolean; reason?: string } {
  if (SUSPICIOUS_REMOTE_PORTS.has(conn.remotePort)) {
    return { suspicious: true, reason: `Known malicious port: ${conn.remotePort}` };
  }
  if (SUSPICIOUS_STATES.has(conn.state)) {
    return { suspicious: true, reason: `Suspicious TCP state: ${conn.state}` };
  }
  if (conn.remoteAddress !== "0.0.0.0" && conn.remoteAddress !== "::" && !conn.remoteAddress.startsWith("127.") && !conn.remoteAddress.startsWith("::1")) {
    // External connection on a high non-standard port (heuristic)
    if (conn.remotePort > 49152 && conn.state === "ESTABLISHED") {
      return { suspicious: true, reason: `Established connection to ephemeral port ${conn.remotePort}` };
    }
  }
  return { suspicious: false };
}
