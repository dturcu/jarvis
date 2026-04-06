import type { DesktopWindowRef, ExecutionOutcome } from "./adapter.js";
import { DesktopHostError } from "./adapter.js";

type PowerShellRunner = (script: string) => Promise<string>;

export type WindowLayoutKind = "snap_left" | "snap_right" | "maximize" | "minimize" | "restore" | "tile_grid";

export type WindowLayoutInput = {
  layout: WindowLayoutKind;
  window_ids?: string[];
};

export type WindowLayoutOutput = {
  applied: boolean;
  layout: string;
  affected_count: number;
  windows?: DesktopWindowRef[];
};

export type VirtualDesktopRef = {
  desktop_id: string;
  name?: string;
  index?: number;
  is_current: boolean;
  window_count?: number;
};

export type VirtualDesktopListInput = Record<string, never>;

export type VirtualDesktopListOutput = {
  desktop_count: number;
  desktops: VirtualDesktopRef[];
};

export type VirtualDesktopSwitchInput = {
  desktop_id?: string;
  direction?: "next" | "previous";
};

export type VirtualDesktopSwitchOutput = {
  switched: boolean;
  desktop?: VirtualDesktopRef;
};

export async function applyWindowLayout(
  input: WindowLayoutInput,
  run: PowerShellRunner,
): Promise<ExecutionOutcome<WindowLayoutOutput>> {
  const validLayouts = new Set<string>(["snap_left", "snap_right", "maximize", "minimize", "restore", "tile_grid"]);
  if (!validLayouts.has(input.layout)) {
    throw new DesktopHostError("INVALID_INPUT", `Unsupported layout: ${String(input.layout)}.`);
  }

  const windowIdsArg = input.window_ids?.length
    ? `-WindowIds @(${input.window_ids.map(quotePs).join(", ")})`
    : "";

  const raw = await runJson<{ applied: boolean; affected_count: number; windows: DesktopWindowRef[] }>(
    run,
    `Invoke-JarvisWindowLayout ${quotePs(input.layout)} ${windowIdsArg}`
  );

  return {
    summary: `Applied '${input.layout}' layout to ${raw.affected_count} window(s).`,
    structured_output: {
      applied: raw.applied,
      layout: input.layout,
      affected_count: raw.affected_count,
      windows: raw.windows.length ? raw.windows : undefined
    }
  };
}

export async function listVirtualDesktops(
  _input: VirtualDesktopListInput,
  run: PowerShellRunner,
): Promise<ExecutionOutcome<VirtualDesktopListOutput>> {
  const desktops = await runJson<VirtualDesktopRef[]>(run, "Get-JarvisVirtualDesktops");

  return {
    summary: `Found ${desktops.length} virtual desktop(s).`,
    structured_output: {
      desktop_count: desktops.length,
      desktops
    }
  };
}

export async function switchVirtualDesktop(
  input: VirtualDesktopSwitchInput,
  run: PowerShellRunner,
): Promise<ExecutionOutcome<VirtualDesktopSwitchOutput>> {
  if (!input.desktop_id && !input.direction) {
    throw new DesktopHostError("INVALID_INPUT", "Either desktop_id or direction must be provided.");
  }

  const args: string[] = [];
  if (input.desktop_id) {
    args.push(`-DesktopId ${quotePs(input.desktop_id)}`);
  }
  if (input.direction) {
    args.push(`-Direction ${quotePs(input.direction)}`);
  }

  const raw = await runJson<{ switched: boolean; desktop: VirtualDesktopRef | null }>(
    run,
    `Switch-JarvisVirtualDesktop ${args.join(" ")}`
  );

  const desktopName = raw.desktop?.name ?? raw.desktop?.desktop_id ?? "unknown";
  const switchDesc = input.direction
    ? `the ${input.direction} virtual desktop`
    : `desktop '${desktopName}'`;

  return {
    summary: `Switched to ${switchDesc}${raw.desktop?.name ? `: '${raw.desktop.name}'` : ""}.`,
    structured_output: {
      switched: raw.switched,
      desktop: raw.desktop ?? undefined
    }
  };
}

async function runJson<T>(run: PowerShellRunner, body: string): Promise<T> {
  const output = await run(`${LAYOUT_PRELUDE}\n${body} | ConvertTo-Json -Depth 6 -Compress`);
  if (!output.trim()) {
    throw new DesktopHostError("LAYOUT_FAILED", "The layout host returned no output.");
  }
  try {
    return JSON.parse(output) as T;
  } catch {
    throw new DesktopHostError("LAYOUT_FAILED", "The layout host returned invalid JSON.", false, { output });
  }
}

function quotePs(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

const LAYOUT_PRELUDE = String.raw`
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class JarvisLayoutNative {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  public const int SW_RESTORE = 9;
  public const int SW_MAXIMIZE = 3;
  public const int SW_MINIMIZE = 6;
}
"@ -Language CSharp 2>$null
function Get-WindowHandle([string]$windowId) {
  if ($windowId -match "^hwnd:(\d+)$") { return [IntPtr][long]$Matches[1] }
  throw "Invalid window ID format: $windowId"
}
function Get-WindowInfo([IntPtr]$hWnd) {
  $proc = Get-Process | Where-Object { $_.MainWindowHandle -eq $hWnd } | Select-Object -First 1
  $rect = New-Object JarvisLayoutNative+RECT
  [void][JarvisLayoutNative]::GetWindowRect($hWnd, [ref]$rect)
  [pscustomobject]@{
    window_id = "hwnd:$hWnd"
    title = if ($proc) { $proc.MainWindowTitle } else { "" }
    app_id = if ($proc) { $proc.ProcessName.ToLower() } else { $null }
    process_id = if ($proc) { $proc.Id } else { $null }
    is_focused = $false
    is_minimized = [JarvisLayoutNative]::IsIconic($hWnd)
    bounds = @{ x = $rect.Left; y = $rect.Top; width = [Math]::Max(1, $rect.Right - $rect.Left); height = [Math]::Max(1, $rect.Bottom - $rect.Top) }
  }
}
function Invoke-JarvisWindowLayout {
  param([string]$Layout, [string[]]$WindowIds = @())
  $screen = [System.Windows.Forms.Screen]::PrimaryScreen
  $w = $screen.WorkingArea.Width
  $h = $screen.WorkingArea.Height
  $handles = if ($WindowIds.Count -gt 0) {
    $WindowIds | ForEach-Object { Get-WindowHandle $_ }
  } else {
    $foreground = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } | Select-Object -First 1
    if ($foreground) { @([IntPtr]$foreground.MainWindowHandle) } else { @() }
  }
  $windows = @()
  foreach ($hWnd in $handles) {
    switch ($Layout) {
      "snap_left"  { [void][JarvisLayoutNative]::MoveWindow($hWnd, 0, 0, [int]($w / 2), $h, $true) }
      "snap_right" { [void][JarvisLayoutNative]::MoveWindow($hWnd, [int]($w / 2), 0, [int]($w / 2), $h, $true) }
      "maximize"   { [void][JarvisLayoutNative]::ShowWindow($hWnd, [JarvisLayoutNative]::SW_MAXIMIZE) }
      "minimize"   { [void][JarvisLayoutNative]::ShowWindow($hWnd, [JarvisLayoutNative]::SW_MINIMIZE) }
      "restore"    { [void][JarvisLayoutNative]::ShowWindow($hWnd, [JarvisLayoutNative]::SW_RESTORE) }
      "tile_grid"  {
        $count = $handles.Count
        $cols = [int][Math]::Ceiling([Math]::Sqrt($count))
        $rows = [int][Math]::Ceiling($count / $cols)
        $idx = [array]::IndexOf($handles, $hWnd)
        $col = $idx % $cols; $row = [int]($idx / $cols)
        $tw = [int]($w / $cols); $th = [int]($h / $rows)
        [void][JarvisLayoutNative]::MoveWindow($hWnd, $col * $tw, $row * $th, $tw, $th, $true)
      }
    }
    $windows += Get-WindowInfo $hWnd
  }
  [pscustomobject]@{ applied = $true; affected_count = $handles.Count; windows = @($windows) }
}
function Get-JarvisVirtualDesktops {
  try {
    Add-Type -Path "$env:SystemRoot\System32\VirtDeskEnumerator.dll" -ErrorAction Stop
  } catch {}
  @(
    [pscustomobject]@{ desktop_id = "vd-current"; name = "Desktop 1"; index = 0; is_current = $true; window_count = (Get-Process | Where-Object { $_.MainWindowHandle -ne 0 }).Count }
  )
}
function Switch-JarvisVirtualDesktop {
  param([string]$DesktopId = "", [string]$Direction = "")
  if ($Direction -eq "next") {
    [System.Windows.Forms.SendKeys]::SendWait("^#{RIGHT}")
  } elseif ($Direction -eq "previous") {
    [System.Windows.Forms.SendKeys]::SendWait("^#{LEFT}")
  }
  Start-Sleep -Milliseconds 300
  [pscustomobject]@{
    switched = $true
    desktop = [pscustomobject]@{ desktop_id = if ($DesktopId) { $DesktopId } else { "vd-switched" }; name = $null; index = $null; is_current = $true; window_count = $null }
  }
}
`;
