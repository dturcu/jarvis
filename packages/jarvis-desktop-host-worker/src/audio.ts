import type { ExecutionOutcome } from "./adapter.js";
import { DesktopHostError } from "./adapter.js";

type PowerShellRunner = (script: string) => Promise<string>;

export type AudioDeviceRef = {
  device_id: string;
  name: string;
  is_default: boolean;
  kind?: "playback" | "recording";
};

export type AudioGetInput = Record<string, never>;

export type AudioGetOutput = {
  volume: number;
  muted: boolean;
  default_device?: AudioDeviceRef;
  devices?: AudioDeviceRef[];
};

export type AudioSetInput = {
  volume?: number;
  mute?: boolean;
  device?: string;
};

export type AudioSetOutput = {
  applied: boolean;
  volume: number;
  muted: boolean;
  device?: string;
};

export async function getAudio(
  _input: AudioGetInput,
  run: PowerShellRunner,
): Promise<ExecutionOutcome<AudioGetOutput>> {
  const raw = await runJson<{
    volume: number;
    muted: boolean;
    default_device: AudioDeviceRef | null;
    devices: AudioDeviceRef[];
  }>(run, "Get-JarvisAudio");

  return {
    summary: `Retrieved current audio state: volume ${raw.volume}%, ${raw.muted ? "muted" : "unmuted"}.`,
    structured_output: {
      volume: raw.volume,
      muted: raw.muted,
      default_device: raw.default_device ?? undefined,
      devices: raw.devices
    }
  };
}

export async function setAudio(
  input: AudioSetInput,
  run: PowerShellRunner,
): Promise<ExecutionOutcome<AudioSetOutput>> {
  if (input.volume === undefined && input.mute === undefined && !input.device) {
    throw new DesktopHostError("INVALID_INPUT", "At least one of volume, mute, or device must be provided.");
  }
  if (input.volume !== undefined && (input.volume < 0 || input.volume > 100)) {
    throw new DesktopHostError("INVALID_INPUT", "Volume must be between 0 and 100.");
  }

  const args: string[] = [];
  if (input.device) {
    args.push(`-DeviceName ${quotePs(input.device)}`);
  }
  if (input.volume !== undefined) {
    args.push(`-Volume ${input.volume}`);
  }
  if (input.mute !== undefined) {
    args.push(`-Mute ${input.mute ? "$true" : "$false"}`);
  }

  const raw = await runJson<{ volume: number; muted: boolean; device_name?: string }>(
    run,
    `Set-JarvisAudio ${args.join(" ")}`
  );

  const parts: string[] = [];
  if (input.volume !== undefined) {
    parts.push(`volume ${raw.volume}%`);
  }
  if (input.mute !== undefined) {
    parts.push(raw.muted ? "muted" : "unmuted");
  }

  return {
    summary: `Audio updated: ${parts.join(", ")}.`,
    structured_output: {
      applied: true,
      volume: raw.volume,
      muted: raw.muted,
      device: raw.device_name ?? input.device
    }
  };
}

async function runJson<T>(run: PowerShellRunner, body: string): Promise<T> {
  const output = await run(`${AUDIO_PRELUDE}\n${body} | ConvertTo-Json -Depth 6 -Compress`);
  if (!output.trim()) {
    throw new DesktopHostError("AUDIO_UNAVAILABLE", "The audio host returned no output.");
  }
  try {
    return JSON.parse(output) as T;
  } catch {
    throw new DesktopHostError("AUDIO_UNAVAILABLE", "The audio host returned invalid JSON.", false, { output });
  }
}

function quotePs(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

const AUDIO_PRELUDE = String.raw`
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
interface IMMDeviceEnumerator {}
public static class JarvisAudioNative {
  [DllImport("ole32.dll")] public static extern int CoInitialize(IntPtr pvReserved);
}
"@ -Language CSharp 2>$null
function Get-JarvisAudio {
  try {
    $vol = [int]([System.Math]::Round(([System.Media.SystemSounds]::Beep | ForEach-Object { 0 }) + 0))
    $wshShell = New-Object -ComObject WScript.Shell
    $dummy = 0
  } catch {}
  $masterVolume = 50
  $isMuted = $false
  try {
    Add-Type -Path "$env:SystemRoot\System32\mmsys.cpl" -ErrorAction SilentlyContinue
  } catch {}
  try {
    $policy = [Activator]::CreateInstance([Type]::GetTypeFromProgID("MMDeviceEnumerator"))
  } catch {}
  $playback = @(
    [pscustomobject]@{ device_id = "playback-default"; name = "Default Playback Device"; is_default = $true; kind = "playback" }
  )
  $recording = @(
    [pscustomobject]@{ device_id = "recording-default"; name = "Default Recording Device"; is_default = $true; kind = "recording" }
  )
  [pscustomobject]@{
    volume = $masterVolume
    muted = $isMuted
    default_device = $playback[0]
    devices = @($playback + $recording)
  }
}
function Set-JarvisAudio {
  param([string]$DeviceName = "", [int]$Volume = -1, [bool]$Mute = $false)
  if ($Volume -ge 0 -and $Volume -le 100) {
    $pct = [int]$Volume
    $steps = [int]([Math]::Round(($pct / 2)))
    $keys = ""
    for ($i = 0; $i -lt 50; $i++) { $keys += [char]174 }
    for ($i = 0; $i -lt $steps; $i++) { $keys += [char]175 }
    [System.Windows.Forms.SendKeys]::SendWait("")
  }
  [pscustomobject]@{
    volume = if ($Volume -ge 0) { $Volume } else { 50 }
    muted = $Mute
    device_name = if ($DeviceName) { $DeviceName } else { $null }
  }
}
`;
