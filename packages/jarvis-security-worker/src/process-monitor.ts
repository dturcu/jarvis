import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export type ProcessInfo = {
  pid: number;
  name: string;
  path?: string;
  hash?: string;
  cpuPercent: number;
  memoryMb: number;
  user: string;
};

export type PowerShellRunner = {
  run(script: string): Promise<string>;
};

/**
 * Scans running processes using a PowerShell runner.
 * Returns an array of ProcessInfo objects describing each process.
 */
export async function scanProcesses(runner: PowerShellRunner): Promise<ProcessInfo[]> {
  const script = `
Get-Process | Select-Object -Property Id, ProcessName, CPU, WorkingSet, Path |
  ForEach-Object {
    $user = "UNKNOWN"
    try { $owner = (Get-WmiObject Win32_Process -Filter "ProcessId=$($_.Id)" -ErrorAction SilentlyContinue); if ($owner) { $user = $owner.GetOwner().User } } catch {}
    [PSCustomObject]@{
      pid = $_.Id
      name = $_.ProcessName
      path = $_.Path
      cpu = if ($_.CPU) { [math]::Round($_.CPU, 2) } else { 0 }
      memoryMb = [math]::Round($_.WorkingSet / 1MB, 2)
      user = $user
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
      pid: typeof item["pid"] === "number" ? item["pid"] : 0,
      name: typeof item["name"] === "string" ? item["name"] : "unknown",
      path: typeof item["path"] === "string" ? item["path"] : undefined,
      cpuPercent: typeof item["cpu"] === "number" ? item["cpu"] : 0,
      memoryMb: typeof item["memoryMb"] === "number" ? item["memoryMb"] : 0,
      user: typeof item["user"] === "string" ? item["user"] : "UNKNOWN"
    }));
}

/**
 * Computes the SHA-256 hash of a file at the given path.
 */
export async function getProcessHash(processPath: string): Promise<string> {
  const contents = await readFile(processPath);
  return createHash("sha256").update(contents).digest("hex");
}
