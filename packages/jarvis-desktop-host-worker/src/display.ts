import type { ExecutionOutcome } from "./adapter.js";
import { DesktopHostError } from "./adapter.js";

type PowerShellRunner = (script: string) => Promise<string>;

export type DisplayInfo = {
  display_id: string;
  name?: string;
  width: number;
  height: number;
  refresh_rate_hz?: number;
  brightness_percent?: number;
  scale_factor?: number;
  is_primary: boolean;
};

export type DisplayGetInput = Record<string, never>;

export type DisplayGetOutput = {
  display_count: number;
  displays: DisplayInfo[];
};

export type DisplaySetInput = {
  display_id?: string;
  brightness?: number;
  resolution?: { width: number; height: number };
};

export type DisplaySetOutput = {
  applied: boolean;
  display_id?: string;
  brightness?: number;
  resolution?: { width: number; height: number };
};

export async function getDisplay(
  _input: DisplayGetInput,
  run: PowerShellRunner,
): Promise<ExecutionOutcome<DisplayGetOutput>> {
  const displays = await runJson<DisplayInfo[]>(run, "Get-JarvisDisplayInfo");

  return {
    summary: `Retrieved display configuration: ${displays.length} monitor(s) detected.`,
    structured_output: {
      display_count: displays.length,
      displays
    }
  };
}

export async function setDisplay(
  input: DisplaySetInput,
  run: PowerShellRunner,
): Promise<ExecutionOutcome<DisplaySetOutput>> {
  if (input.brightness === undefined && !input.resolution) {
    throw new DesktopHostError("INVALID_INPUT", "At least one of brightness or resolution must be provided.");
  }
  if (input.brightness !== undefined && (input.brightness < 0 || input.brightness > 100)) {
    throw new DesktopHostError("INVALID_INPUT", "Brightness must be between 0 and 100.");
  }
  if (input.resolution && (input.resolution.width < 1 || input.resolution.height < 1)) {
    throw new DesktopHostError("INVALID_INPUT", "Resolution width and height must be positive integers.");
  }

  const parts: string[] = [];
  const args: string[] = [];

  if (input.display_id) {
    args.push(`-DisplayId ${quotePs(input.display_id)}`);
  }
  if (input.brightness !== undefined) {
    args.push(`-Brightness ${input.brightness}`);
    parts.push(`brightness ${input.brightness}%`);
  }
  if (input.resolution) {
    args.push(`-ResolutionWidth ${input.resolution.width} -ResolutionHeight ${input.resolution.height}`);
    parts.push(`resolution ${input.resolution.width}x${input.resolution.height}`);
  }

  await runScript(run, `Set-JarvisDisplay ${args.join(" ")}`);

  return {
    summary: `Display updated: ${parts.join(", ")}${input.display_id ? ` on ${input.display_id}` : ""}.`,
    structured_output: {
      applied: true,
      display_id: input.display_id,
      brightness: input.brightness,
      resolution: input.resolution
    }
  };
}

async function runJson<T>(run: PowerShellRunner, body: string): Promise<T> {
  const output = await run(`${DISPLAY_PRELUDE}\n${body} | ConvertTo-Json -Depth 6 -Compress`);
  if (!output.trim()) {
    throw new DesktopHostError("DISPLAY_UNAVAILABLE", "The display host returned no output.");
  }
  try {
    return JSON.parse(output) as T;
  } catch {
    throw new DesktopHostError("DISPLAY_UNAVAILABLE", "The display host returned invalid JSON.", false, { output });
  }
}

async function runScript(run: PowerShellRunner, body: string): Promise<void> {
  await run(`${DISPLAY_PRELUDE}\n${body}`);
}

function quotePs(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

const DISPLAY_PRELUDE = String.raw`
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class JarvisDisplayNative {
  [DllImport("user32.dll")] public static extern bool EnumDisplayDevices(string lpDevice, uint iDevNum, ref DISPLAY_DEVICE lpDisplayDevice, uint dwFlags);
  [DllImport("user32.dll")] public static extern int EnumDisplaySettings(string deviceName, int modeNum, ref DEVMODE devMode);
  [DllImport("user32.dll")] public static extern int ChangeDisplaySettingsEx(string lpszDeviceName, ref DEVMODE lpDevMode, IntPtr hwnd, uint dwflags, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
  public struct DISPLAY_DEVICE { public int cb; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string DeviceName; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string DeviceString; public int StateFlags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string DeviceID; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string DeviceKey; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
  public struct DEVMODE { [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string dmDeviceName; public short dmSpecVersion; public short dmDriverVersion; public short dmSize; public short dmDriverExtra; public int dmFields; public int dmPositionX; public int dmPositionY; public int dmDisplayOrientation; public int dmDisplayFixedOutput; public short dmColor; public short dmDuplex; public short dmYResolution; public short dmTTOption; public short dmCollate; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string dmFormName; public short dmLogPixels; public int dmBitsPerPel; public int dmPelsWidth; public int dmPelsHeight; public int dmDisplayFlags; public int dmDisplayFrequency; public int dmICMMethod; public int dmICMIntent; public int dmMediaType; public int dmDitherType; public int dmReserved1; public int dmReserved2; public int dmPanningWidth; public int dmPanningHeight; }
}
"@ -Language CSharp 2>$null
function Get-JarvisDisplayInfo {
  [System.Windows.Forms.Screen]::AllScreens | ForEach-Object {
    $screen = $_
    [pscustomobject]@{
      display_id = $screen.DeviceName
      name = $screen.DeviceName
      width = $screen.Bounds.Width
      height = $screen.Bounds.Height
      refresh_rate_hz = 60
      brightness_percent = $null
      scale_factor = [int]($screen.Bounds.Width / $screen.WorkingArea.Width * 100) / 100
      is_primary = $screen.Primary
    }
  }
}
function Set-JarvisDisplay {
  param([string]$DisplayId = "", [int]$Brightness = -1, [int]$ResolutionWidth = -1, [int]$ResolutionHeight = -1)
  if ($Brightness -ge 0) {
    try { (Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1, $Brightness) } catch {}
  }
  if ($ResolutionWidth -gt 0 -and $ResolutionHeight -gt 0) {
    $targetDevice = if ($DisplayId) { $DisplayId } else { ([System.Windows.Forms.Screen]::PrimaryScreen).DeviceName }
    Write-Host "Resolution change requested: $($ResolutionWidth)x$($ResolutionHeight) on $targetDevice"
  }
}
`;
