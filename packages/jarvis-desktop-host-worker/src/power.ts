import type { ExecutionOutcome } from "./adapter.js";
import { DesktopHostError } from "./adapter.js";

type PowerShellRunner = (script: string) => Promise<string>;

export type PowerActionKind = "sleep" | "hibernate" | "shutdown" | "restart" | "lock";

export type PowerActionInput = {
  action: PowerActionKind;
};

export type PowerActionOutput = {
  initiated: boolean;
  action: PowerActionKind;
};

export async function executePowerAction(
  input: PowerActionInput,
  run: PowerShellRunner,
): Promise<ExecutionOutcome<PowerActionOutput>> {
  const validActions = new Set<string>(["sleep", "hibernate", "shutdown", "restart", "lock"]);
  if (!validActions.has(input.action)) {
    throw new DesktopHostError(
      "INVALID_INPUT",
      `Unsupported power action: ${String(input.action)}. Valid actions are: sleep, hibernate, shutdown, restart, lock.`
    );
  }

  await runScript(run, `Invoke-JarvisPowerAction ${quotePs(input.action)}`);

  return {
    summary: `Power action '${input.action}' initiated successfully.`,
    structured_output: {
      initiated: true,
      action: input.action
    }
  };
}

async function runScript(run: PowerShellRunner, body: string): Promise<void> {
  await run(`${POWER_PRELUDE}\n${body}`);
}

function quotePs(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

const POWER_PRELUDE = String.raw`
$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class JarvisPowerNative {
  [DllImport("user32.dll")] public static extern bool LockWorkStation();
  [DllImport("PowrProf.dll", SetLastError=true)] public static extern bool SetSuspendState(bool hibernate, bool forceCritical, bool disableWakeEvent);
}
"@ -Language CSharp 2>$null
function Invoke-JarvisPowerAction([string]$action) {
  switch ($action) {
    "lock"      { [void][JarvisPowerNative]::LockWorkStation() }
    "sleep"     { [void][JarvisPowerNative]::SetSuspendState($false, $false, $false) }
    "hibernate" { [void][JarvisPowerNative]::SetSuspendState($true, $false, $false) }
    "shutdown"  { Stop-Computer -Force }
    "restart"   { Restart-Computer -Force }
    default     { throw "Unsupported power action: $action" }
  }
}
`;
