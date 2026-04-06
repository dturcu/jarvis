import { Type } from "@sinclair/typebox";
import {
  definePluginEntry,
  type AnyAgentTool,
  type OpenClawPluginToolContext,
  type PluginCommandContext
} from "openclaw/plugin-sdk/plugin-entry";
import {
  VOICE_TOOL_NAMES,
  VOICE_COMMAND_NAMES,
  safeJsonParse,
  submitVoiceListen,
  submitVoiceTranscribe,
  submitVoiceSpeak,
  submitVoiceWakeWordStart,
  submitVoiceWakeWordStop,
  toCommandReply,
  toToolResult,
  type VoiceListenParams,
  type VoiceTranscribeParams,
  type VoiceSpeakParams,
  type VoiceWakeWordStartParams,
  type VoiceWakeWordStopParams,
  type ToolResponse
} from "@jarvis/shared";

function createVoiceTool(
  ctx: OpenClawPluginToolContext,
  name: string,
  label: string,
  description: string,
  parameters: ReturnType<typeof Type.Object>,
  submit: (ctx: OpenClawPluginToolContext | undefined, params: any) => ToolResponse,
): AnyAgentTool {
  return {
    name,
    label,
    description,
    parameters,
    execute: async (_toolCallId, params) => toToolResult(submit(ctx, params))
  };
}

export function createVoiceTools(ctx: OpenClawPluginToolContext): AnyAgentTool[] {
  return [
    createVoiceTool(
      ctx,
      "voice_listen",
      "Voice Listen",
      "Capture audio from the microphone for a specified duration.",
      Type.Object({
        duration_seconds: Type.Optional(Type.Number({
          minimum: 1,
          maximum: 300,
          description: "Duration to record in seconds (default 5)."
        })),
        device_id: Type.Optional(Type.String({
          minLength: 1,
          description: "Microphone device ID. Omit for system default."
        }))
      }),
      (toolCtx, params: { duration_seconds?: number; device_id?: string }) =>
        submitVoiceListen(toolCtx, {
          durationSeconds: params.duration_seconds,
          deviceId: params.device_id
        })
    ),
    createVoiceTool(
      ctx,
      "voice_transcribe",
      "Voice Transcribe",
      "Transcribe an audio artifact to text using Whisper STT.",
      Type.Object({
        audio_artifact_id: Type.String({
          minLength: 1,
          description: "Artifact ID of the audio to transcribe."
        }),
        language: Type.Optional(Type.String({
          minLength: 2,
          maxLength: 5,
          description: "BCP-47 language code (e.g. 'en', 'fr'). Auto-detected if omitted."
        })),
        model: Type.Optional(Type.String({
          minLength: 1,
          description: "Whisper model to use (tiny, base, small, medium, large)."
        }))
      }),
      (toolCtx, params: { audio_artifact_id: string; language?: string; model?: string }) =>
        submitVoiceTranscribe(toolCtx, {
          audioArtifactId: params.audio_artifact_id,
          language: params.language,
          model: params.model
        })
    ),
    createVoiceTool(
      ctx,
      "voice_speak",
      "Voice Speak",
      "Synthesise text to speech using Piper TTS or Windows SAPI.",
      Type.Object({
        text: Type.String({
          minLength: 1,
          description: "Text to synthesise."
        }),
        voice: Type.Optional(Type.String({
          minLength: 1,
          description: "Voice model name (e.g. 'en_US-lessac-medium'). System default if omitted."
        })),
        speed: Type.Optional(Type.Number({
          minimum: 0.5,
          maximum: 3.0,
          description: "Speech speed multiplier (1.0 = normal)."
        })),
        output_name: Type.Optional(Type.String({
          minLength: 1,
          description: "Filename for the output audio artifact."
        }))
      }),
      (toolCtx, params: { text: string; voice?: string; speed?: number; output_name?: string }) =>
        submitVoiceSpeak(toolCtx, {
          text: params.text,
          voice: params.voice,
          speed: params.speed,
          outputName: params.output_name
        })
    ),
    createVoiceTool(
      ctx,
      "voice_wake_word_start",
      "Voice Wake Word Start",
      "Start listening for a wake word (e.g. 'jarvis') using Porcupine or a compatible engine.",
      Type.Object({
        keyword: Type.Optional(Type.String({
          minLength: 1,
          description: "Wake word keyword (default 'jarvis')."
        })),
        sensitivity: Type.Optional(Type.Number({
          minimum: 0,
          maximum: 1,
          description: "Detection sensitivity 0-1 (default 0.5)."
        }))
      }),
      (toolCtx, params: { keyword?: string; sensitivity?: number }) =>
        submitVoiceWakeWordStart(toolCtx, {
          keyword: params.keyword,
          sensitivity: params.sensitivity
        })
    ),
    createVoiceTool(
      ctx,
      "voice_wake_word_stop",
      "Voice Wake Word Stop",
      "Stop the active wake word detection session.",
      Type.Object({}),
      (toolCtx, _params: VoiceWakeWordStopParams) =>
        submitVoiceWakeWordStop(toolCtx, {})
    )
  ];
}

function toToolContext(ctx: PluginCommandContext): OpenClawPluginToolContext {
  return {
    sessionKey: ctx.sessionKey,
    sessionId: ctx.sessionId,
    messageChannel: ctx.channel,
    requesterSenderId: ctx.senderId
  };
}

function formatJobReply(response: ToolResponse): string {
  const parts = [response.summary];
  if (response.job_id) parts.push(`job=${response.job_id}`);
  if (response.approval_id) parts.push(`approval=${response.approval_id}`);
  return parts.join(" | ");
}

function invalidJsonReply(commandName: string) {
  return toCommandReply(`Invalid JSON arguments for /${commandName}.`, true);
}

export function createVoiceCommand() {
  return {
    name: "voice",
    description: "Voice interface commands: listen, transcribe, speak, wake-word start/stop.",
    acceptsArgs: true,
    handler: (ctx: PluginCommandContext) => {
      const args = safeJsonParse<{ action: string; [key: string]: unknown }>(ctx.args);
      if (!args) return invalidJsonReply("voice");

      const toolCtx = toToolContext(ctx);
      switch (args.action) {
        case "listen": {
          const response = submitVoiceListen(toolCtx, {
            durationSeconds: typeof args.duration_seconds === "number" ? args.duration_seconds : undefined,
            deviceId: typeof args.device_id === "string" ? args.device_id : undefined
          });
          return toCommandReply(formatJobReply(response));
        }
        case "transcribe": {
          if (typeof args.audio_artifact_id !== "string") {
            return toCommandReply("voice transcribe requires audio_artifact_id.", true);
          }
          const response = submitVoiceTranscribe(toolCtx, {
            audioArtifactId: args.audio_artifact_id,
            language: typeof args.language === "string" ? args.language : undefined,
            model: typeof args.model === "string" ? args.model : undefined
          });
          return toCommandReply(formatJobReply(response));
        }
        case "speak": {
          if (typeof args.text !== "string") {
            return toCommandReply("voice speak requires text.", true);
          }
          const response = submitVoiceSpeak(toolCtx, {
            text: args.text,
            voice: typeof args.voice === "string" ? args.voice : undefined,
            speed: typeof args.speed === "number" ? args.speed : undefined
          });
          return toCommandReply(formatJobReply(response));
        }
        case "wake_word_start": {
          const response = submitVoiceWakeWordStart(toolCtx, {
            keyword: typeof args.keyword === "string" ? args.keyword : undefined,
            sensitivity: typeof args.sensitivity === "number" ? args.sensitivity : undefined
          });
          return toCommandReply(formatJobReply(response));
        }
        case "wake_word_stop": {
          const response = submitVoiceWakeWordStop(toolCtx, {});
          return toCommandReply(formatJobReply(response));
        }
        default:
          return toCommandReply(
            `Unknown /voice action: ${String(args.action)}. Valid actions: listen, transcribe, speak, wake_word_start, wake_word_stop.`,
            true
          );
      }
    }
  };
}

export function createListenCommand() {
  return {
    name: "listen",
    description: "Capture audio from the microphone. Args: {duration_seconds?, device_id?}",
    acceptsArgs: true,
    handler: (ctx: PluginCommandContext) => {
      const args = safeJsonParse<VoiceListenParams>(ctx.args) ?? {};
      const toolCtx = toToolContext(ctx);
      const response = submitVoiceListen(toolCtx, {
        durationSeconds: args.durationSeconds,
        deviceId: args.deviceId
      });
      return toCommandReply(formatJobReply(response));
    }
  };
}

export function createSpeakCommand() {
  return {
    name: "speak",
    description: "Synthesise text to speech. Args: {text, voice?, speed?}",
    acceptsArgs: true,
    handler: (ctx: PluginCommandContext) => {
      const args = safeJsonParse<VoiceSpeakParams>(ctx.args);
      if (!args?.text) {
        return toCommandReply("Usage: /speak {\"text\": \"...\"}", true);
      }
      const toolCtx = toToolContext(ctx);
      const response = submitVoiceSpeak(toolCtx, {
        text: args.text,
        voice: args.voice,
        speed: args.speed,
        outputName: args.outputName
      });
      return toCommandReply(formatJobReply(response));
    }
  };
}

export const jarvisVoiceToolNames = [...VOICE_TOOL_NAMES];
export const jarvisVoiceCommandNames = [...VOICE_COMMAND_NAMES];

export default definePluginEntry({
  id: "jarvis-voice",
  name: "Jarvis Voice",
  description: "Voice interface plugin for audio capture, Whisper STT transcription, Piper/SAPI TTS synthesis, and wake word detection",
  register(api) {
    api.registerTool((ctx) => createVoiceTools(ctx));
    api.registerCommand(createVoiceCommand());
    api.registerCommand(createListenCommand());
    api.registerCommand(createSpeakCommand());
  }
});
