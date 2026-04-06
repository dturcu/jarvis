import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { stat } from "node:fs/promises";
import type { VoiceAdapter, VoiceExecutionOutcome } from "./adapter.js";
import type {
  VoiceListenInput,
  VoiceListenOutput,
  VoiceTranscribeInput,
  VoiceTranscribeOutput,
  VoiceSpeakInput,
  VoiceSpeakOutput,
  VoiceWakeWordStartInput,
  VoiceWakeWordStartOutput,
  VoiceWakeWordStopInput,
  VoiceWakeWordStopOutput
} from "./types.js";
import { captureAudio } from "./capture.js";
import { transcribeWithWhisper } from "./stt.js";
import { synthesizeWithPiper, synthesizeWithSAPI } from "./tts.js";
import { VoiceWorkerError } from "./adapter.js";

export type RealVoiceAdapterOptions = {
  /** Directory for storing audio artifacts. Defaults to os.tmpdir()/jarvis-voice */
  artifactsDir?: string;
  /** TTS engine to use: "piper" (default, cross-platform) or "sapi" (Windows-only) */
  ttsEngine?: "piper" | "sapi";
};

export class RealVoiceAdapter implements VoiceAdapter {
  private readonly artifactsDir: string;
  private readonly ttsEngine: "piper" | "sapi";
  private activeWakeWordSessionId: string | null = null;
  private wakeWordActive = false;

  constructor(options: RealVoiceAdapterOptions = {}) {
    this.artifactsDir = options.artifactsDir ?? join(tmpdir(), "jarvis-voice");
    this.ttsEngine = options.ttsEngine ?? "piper";
  }

  async listen(input: VoiceListenInput): Promise<VoiceExecutionOutcome<VoiceListenOutput>> {
    const artifactId = `audio-${randomUUID()}`;
    const outputPath = join(this.artifactsDir, `${artifactId}.wav`);

    try {
      const result = await captureAudio({
        durationSeconds: input.duration_seconds,
        deviceId: input.device_id,
        outputPath,
      });

      // Attempt to read actual file size to confirm capture worked
      let actualDuration = input.duration_seconds;
      try {
        const stats = await stat(outputPath);
        // WAV at 16kHz mono 16-bit = 32000 bytes/sec + 44 byte header
        const dataBytes = Math.max(0, stats.size - 44);
        actualDuration = Number((dataBytes / (result.sampleRate * 2)).toFixed(2));
      } catch {
        // Fall back to requested duration
      }

      return {
        summary: `Captured ${actualDuration}s of audio from device '${input.device_id ?? "default"}'.`,
        structured_output: {
          audio_artifact_id: artifactId,
          duration_seconds: actualDuration,
          format: result.format,
          sample_rate: result.sampleRate,
        },
      };
    } catch (error) {
      throw new VoiceWorkerError(
        "CAPTURE_FAILED",
        `Audio capture failed: ${error instanceof Error ? error.message : "unknown error"}`,
        true,
        { device_id: input.device_id ?? "default", duration_seconds: input.duration_seconds },
      );
    }
  }

  async transcribe(input: VoiceTranscribeInput): Promise<VoiceExecutionOutcome<VoiceTranscribeOutput>> {
    // Resolve artifact ID to file path — support both bare IDs and full paths
    const audioPath = input.audio_artifact_id.includes("/") || input.audio_artifact_id.includes("\\")
      ? input.audio_artifact_id
      : join(this.artifactsDir, `${input.audio_artifact_id}.wav`);

    try {
      const result = await transcribeWithWhisper(audioPath, {
        model: input.model,
        language: input.language,
      });

      return {
        summary: `Transcribed audio artifact '${input.audio_artifact_id}' using model '${input.model ?? "base"}' in language '${result.language}'.`,
        structured_output: {
          text: result.text,
          language: result.language,
          confidence: result.confidence,
          segments: result.segments,
        },
      };
    } catch (error) {
      throw new VoiceWorkerError(
        "TRANSCRIPTION_FAILED",
        `Transcription failed: ${error instanceof Error ? error.message : "unknown error"}`,
        true,
        { audio_artifact_id: input.audio_artifact_id, model: input.model ?? "base" },
      );
    }
  }

  async speak(input: VoiceSpeakInput): Promise<VoiceExecutionOutcome<VoiceSpeakOutput>> {
    const artifactId = input.output_name ?? `tts-${randomUUID()}`;
    const outputPath = join(this.artifactsDir, `${artifactId}.wav`);
    const voice = input.voice ?? (this.ttsEngine === "sapi" ? "" : "en_US-lessac-medium");
    const speed = input.speed ?? 1.0;

    try {
      if (this.ttsEngine === "sapi") {
        await synthesizeWithSAPI(input.text, { voice, speed, outputPath });
      } else {
        await synthesizeWithPiper(input.text, { voice, speed, outputPath });
      }

      // Read actual duration from the generated WAV file
      let durationSeconds: number;
      try {
        const stats = await stat(outputPath);
        // WAV 16-bit mono at ~22050Hz (Piper default) or ~16000Hz (SAPI)
        // We estimate conservatively — the exact rate depends on the engine
        const sampleRate = this.ttsEngine === "sapi" ? 22050 : 22050;
        const dataBytes = Math.max(0, stats.size - 44);
        durationSeconds = Number((dataBytes / (sampleRate * 2)).toFixed(2));
      } catch {
        // Estimate from character count if file stat fails
        const charCount = input.text.length;
        durationSeconds = Number((charCount / (14 * speed)).toFixed(2));
      }

      return {
        summary: `Synthesised ${input.text.length} characters of text using voice '${voice}' (${this.ttsEngine}).`,
        structured_output: {
          audio_artifact_id: artifactId,
          duration_seconds: durationSeconds,
          voice: voice || "system-default",
          format: "wav",
        },
      };
    } catch (error) {
      throw new VoiceWorkerError(
        "TTS_FAILED",
        `Speech synthesis failed (${this.ttsEngine}): ${error instanceof Error ? error.message : "unknown error"}`,
        true,
        { engine: this.ttsEngine, voice, text_length: input.text.length },
      );
    }
  }

  async wakeWordStart(input: VoiceWakeWordStartInput): Promise<VoiceExecutionOutcome<VoiceWakeWordStartOutput>> {
    // Stub implementation — mark as active but do not spawn a real background listener yet.
    // A production implementation would use Porcupine or openWakeWord here.
    if (this.wakeWordActive) {
      throw new VoiceWorkerError(
        "ALREADY_ACTIVE",
        `Wake word detection is already active (session: ${this.activeWakeWordSessionId}).`,
        false,
      );
    }

    const sessionId = `ww-${randomUUID()}`;
    this.activeWakeWordSessionId = sessionId;
    this.wakeWordActive = true;

    return {
      summary: `Wake word detection started for keyword '${input.keyword}' with sensitivity ${input.sensitivity}. (stub — no real background listener)`,
      structured_output: {
        session_id: sessionId,
        keyword: input.keyword,
        listening: true,
      },
    };
  }

  async wakeWordStop(_input: VoiceWakeWordStopInput): Promise<VoiceExecutionOutcome<VoiceWakeWordStopOutput>> {
    const sessionId = this.activeWakeWordSessionId ?? `ww-${randomUUID()}`;
    const wasActive = this.wakeWordActive;

    this.activeWakeWordSessionId = null;
    this.wakeWordActive = false;

    return {
      summary: wasActive
        ? `Wake word detection session '${sessionId}' stopped.`
        : "Wake word detection was not active; nothing to stop.",
      structured_output: {
        session_id: sessionId,
        stopped: true,
      },
    };
  }
}

export function createRealVoiceAdapter(options?: RealVoiceAdapterOptions): VoiceAdapter {
  return new RealVoiceAdapter(options);
}
