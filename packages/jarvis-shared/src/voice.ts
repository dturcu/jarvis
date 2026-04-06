import type { OpenClawPluginToolContext } from "openclaw/plugin-sdk/plugin-entry";
import { getJarvisState } from "./state.js";
import type { ToolResponse } from "./types.js";

export type VoiceListenParams = { durationSeconds?: number; deviceId?: string };
export type VoiceTranscribeParams = { audioArtifactId: string; language?: string; model?: string };
export type VoiceSpeakParams = { text: string; voice?: string; speed?: number; outputName?: string };
export type VoiceWakeWordStartParams = { keyword?: string; sensitivity?: number };
export type VoiceWakeWordStopParams = Record<string, never>;

export function submitVoiceListen(
  ctx: OpenClawPluginToolContext | undefined,
  params: VoiceListenParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "voice.listen",
    input: {
      duration_seconds: params.durationSeconds ?? 5,
      device_id: params.deviceId
    }
  });
}

export function submitVoiceTranscribe(
  ctx: OpenClawPluginToolContext | undefined,
  params: VoiceTranscribeParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "voice.transcribe",
    input: {
      audio_artifact_id: params.audioArtifactId,
      language: params.language,
      model: params.model
    }
  });
}

export function submitVoiceSpeak(
  ctx: OpenClawPluginToolContext | undefined,
  params: VoiceSpeakParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "voice.speak",
    input: {
      text: params.text,
      voice: params.voice,
      speed: params.speed,
      output_name: params.outputName
    }
  });
}

export function submitVoiceWakeWordStart(
  ctx: OpenClawPluginToolContext | undefined,
  params: VoiceWakeWordStartParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "voice.wake_word_start",
    input: {
      keyword: params.keyword ?? "jarvis",
      sensitivity: params.sensitivity ?? 0.5
    }
  });
}

export function submitVoiceWakeWordStop(
  ctx: OpenClawPluginToolContext | undefined,
  _params: VoiceWakeWordStopParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "voice.wake_word_stop",
    input: {}
  });
}
